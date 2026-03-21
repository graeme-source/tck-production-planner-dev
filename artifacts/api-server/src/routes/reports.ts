import { Router, type IRouter } from "express";
import { db, stationBreaksTable, usersTable, productionPlansTable, appSettingsTable } from "@workspace/db";
import { eq, and, gte, lte, sql, isNotNull } from "drizzle-orm";

const router: IRouter = Router();

router.get("/breaks", async (req, res) => {
  const { from, to } = req.query;

  const conditions = [isNotNull(stationBreaksTable.endedAt)];
  if (from) conditions.push(gte(stationBreaksTable.startedAt, new Date(String(from))));
  if (to) {
    const toDate = new Date(String(to));
    toDate.setHours(23, 59, 59, 999);
    conditions.push(lte(stationBreaksTable.startedAt, toDate));
  }

  const rows = await db
    .select({
      id: stationBreaksTable.id,
      planId: stationBreaksTable.planId,
      stationType: stationBreaksTable.stationType,
      userId: stationBreaksTable.userId,
      breakType: stationBreaksTable.breakType,
      startedAt: stationBreaksTable.startedAt,
      endedAt: stationBreaksTable.endedAt,
      userName: usersTable.name,
      planDate: productionPlansTable.planDate,
    })
    .from(stationBreaksTable)
    .leftJoin(usersTable, eq(stationBreaksTable.userId, usersTable.id))
    .leftJoin(productionPlansTable, eq(stationBreaksTable.planId, productionPlansTable.id))
    .where(and(...conditions))
    .orderBy(sql`${stationBreaksTable.startedAt} DESC`);

  const [breakSetting] = await db
    .select({ key: appSettingsTable.key, value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "default_break_minutes"));
  const [lunchSetting] = await db
    .select({ key: appSettingsTable.key, value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "default_lunch_minutes"));

  const defaultBreakMinutes = breakSetting ? Number(breakSetting.value) : 15;
  const defaultLunchMinutes = lunchSetting ? Number(lunchSetting.value) : 45;

  const records = rows.map((r) => {
    const durationMs = r.endedAt!.getTime() - r.startedAt.getTime();
    const durationMinutes = Math.round(durationMs / 60000);
    const allowedMinutes = r.breakType === "lunch" ? defaultLunchMinutes : defaultBreakMinutes;
    const overUnder = durationMinutes - allowedMinutes;
    return {
      id: r.id,
      planId: r.planId,
      planDate: r.planDate,
      stationType: r.stationType,
      userId: r.userId,
      userName: r.userName ?? "Unknown",
      breakType: r.breakType,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt!.toISOString(),
      durationMinutes,
      allowedMinutes,
      overUnder,
    };
  });

  const userMap = new Map<number, { name: string; breakTotal: number; breakCount: number; lunchTotal: number; lunchCount: number }>();
  for (const r of records) {
    if (!r.userId) continue;
    if (!userMap.has(r.userId)) {
      userMap.set(r.userId, { name: r.userName, breakTotal: 0, breakCount: 0, lunchTotal: 0, lunchCount: 0 });
    }
    const u = userMap.get(r.userId)!;
    if (r.breakType === "lunch") {
      u.lunchTotal += r.durationMinutes;
      u.lunchCount++;
    } else {
      u.breakTotal += r.durationMinutes;
      u.breakCount++;
    }
  }

  const userSummaries = Array.from(userMap.entries()).map(([userId, u]) => ({
    userId,
    userName: u.name,
    avgBreakMinutes: u.breakCount > 0 ? Math.round(u.breakTotal / u.breakCount) : null,
    avgLunchMinutes: u.lunchCount > 0 ? Math.round(u.lunchTotal / u.lunchCount) : null,
    totalBreakMinutes: u.breakTotal,
    totalLunchMinutes: u.lunchTotal,
    breakCount: u.breakCount,
    lunchCount: u.lunchCount,
  }));

  res.json({
    records,
    userSummaries,
    defaults: { breakMinutes: defaultBreakMinutes, lunchMinutes: defaultLunchMinutes },
  });
});

export default router;
