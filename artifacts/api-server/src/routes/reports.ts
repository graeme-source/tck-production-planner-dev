import { Router, type IRouter } from "express";
import {
  db,
  stationBreaksTable,
  usersTable,
  productionPlansTable,
  appSettingsTable,
  batchCompletionsTable,
  productionPlanItemsTable,
  recipesTable,
  timingStandardsTable,
  dispatchOrdersTable,
} from "@workspace/db";
import { eq, and, gte, lte, sql, isNotNull, inArray } from "drizzle-orm";
import { getFulfilledOrdersForDateRange } from "../services/shopify";

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

router.get("/production-kpis", async (req, res) => {
  const { from, to } = req.query;

  if (from && isNaN(new Date(String(from)).getTime())) {
    res.status(400).json({ error: "Invalid 'from' date" });
    return;
  }
  if (to && isNaN(new Date(String(to)).getTime())) {
    res.status(400).json({ error: "Invalid 'to' date" });
    return;
  }

  const completionConditions: any[] = [];
  if (from) completionConditions.push(sql`${batchCompletionsTable.completedAt} >= ${new Date(String(from)).toISOString()}`);
  if (to) {
    const toDate = new Date(String(to));
    toDate.setHours(23, 59, 59, 999);
    completionConditions.push(sql`${batchCompletionsTable.completedAt} <= ${toDate.toISOString()}`);
  }

  const completions = await db
    .select({
      id: batchCompletionsTable.id,
      planItemId: batchCompletionsTable.planItemId,
      stationType: batchCompletionsTable.stationType,
      userId: batchCompletionsTable.userId,
      startedAt: batchCompletionsTable.startedAt,
      completedAt: batchCompletionsTable.completedAt,
      planId: productionPlanItemsTable.planId,
      recipeId: productionPlanItemsTable.recipeId,
      recipeName: recipesTable.name,
      planDate: productionPlansTable.planDate,
      planName: productionPlansTable.name,
      userName: usersTable.name,
    })
    .from(batchCompletionsTable)
    .innerJoin(productionPlanItemsTable, eq(batchCompletionsTable.planItemId, productionPlanItemsTable.id))
    .innerJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .innerJoin(productionPlansTable, eq(productionPlanItemsTable.planId, productionPlansTable.id))
    .leftJoin(usersTable, eq(batchCompletionsTable.userId, usersTable.id))
    .where(completionConditions.length > 0 ? and(...completionConditions) : undefined)
    .orderBy(sql`${batchCompletionsTable.completedAt} DESC`);

  const timingStandards = await db.select().from(timingStandardsTable);
  const standardsMap = new Map(timingStandards.map(t => [t.stationType, {
    target: Number(t.targetBatchesPerHour),
    min: Number(t.minBatchesPerHour),
    label: t.stationLabel,
  }]));

  const breakConditions: any[] = [isNotNull(stationBreaksTable.endedAt)];
  if (from) breakConditions.push(sql`${stationBreaksTable.startedAt} >= ${new Date(String(from)).toISOString()}`);
  if (to) {
    const toDate = new Date(String(to));
    toDate.setHours(23, 59, 59, 999);
    breakConditions.push(sql`${stationBreaksTable.startedAt} <= ${toDate.toISOString()}`);
  }

  const breaks = await db
    .select({
      planId: stationBreaksTable.planId,
      stationType: stationBreaksTable.stationType,
      userId: stationBreaksTable.userId,
      startedAt: stationBreaksTable.startedAt,
      endedAt: stationBreaksTable.endedAt,
    })
    .from(stationBreaksTable)
    .where(and(...breakConditions));

  type SessionKey = string;
  function makeKey(date: string, station: string, userId: number | null, planId: number): SessionKey {
    return `${date}|${station}|${userId ?? 0}|${planId}`;
  }

  const sessionMap = new Map<SessionKey, {
    date: string;
    station: string;
    userId: number | null;
    userName: string;
    batchCount: number;
    earliestAt: Date;
    latestAt: Date;
    breakMinutes: number;
    planId: number;
    planName: string;
    recipes: Map<string, number>;
  }>();

  for (const c of completions) {
    const date = c.planDate ?? c.completedAt.toISOString().slice(0, 10);
    const key = makeKey(date, c.stationType, c.userId, c.planId);
    if (!sessionMap.has(key)) {
      sessionMap.set(key, {
        date,
        station: c.stationType,
        userId: c.userId,
        userName: c.userName ?? "Unknown",
        batchCount: 0,
        earliestAt: c.completedAt,
        latestAt: c.completedAt,
        breakMinutes: 0,
        planId: c.planId,
        planName: c.planName,
        recipes: new Map(),
      });
    }
    const s = sessionMap.get(key)!;
    s.batchCount++;
    const ts = c.startedAt ?? c.completedAt;
    if (ts < s.earliestAt) s.earliestAt = ts;
    if (c.completedAt > s.latestAt) s.latestAt = c.completedAt;
    s.recipes.set(c.recipeName, (s.recipes.get(c.recipeName) ?? 0) + 1);
  }

  for (const b of breaks) {
    if (!b.endedAt) continue;
    const date = b.startedAt.toISOString().slice(0, 10);
    const key = makeKey(date, b.stationType, b.userId, b.planId);
    const s = sessionMap.get(key);
    if (s) {
      const mins = Math.max(0, (b.endedAt.getTime() - b.startedAt.getTime()) / 60000);
      s.breakMinutes += mins;
    }
  }

  const dailySessions: Array<{
    date: string;
    station: string;
    stationLabel: string;
    userId: number | null;
    userName: string;
    planId: number;
    planName: string;
    batchCount: number;
    activeMinutes: number;
    breakMinutes: number;
    bph: number;
    targetBph: number | null;
    minBph: number | null;
    status: "above" | "on-target" | "below" | "unknown";
    recipes: Array<{ name: string; count: number }>;
  }> = [];

  for (const s of sessionMap.values()) {
    const totalElapsed = Math.max(0, (s.latestAt.getTime() - s.earliestAt.getTime()) / 60000);
    const activeMinutes = Math.max(0, totalElapsed - s.breakMinutes);
    const bph = activeMinutes > 0 ? s.batchCount / (activeMinutes / 60) : 0;
    const standard = standardsMap.get(s.station);
    const targetBph = standard?.target ?? null;
    const minBph = standard?.min ?? null;
    let status: "above" | "on-target" | "below" | "unknown" = "unknown";
    if (targetBph !== null && minBph !== null) {
      if (bph >= targetBph) status = "above";
      else if (bph >= minBph) status = "on-target";
      else status = "below";
    }

    dailySessions.push({
      date: s.date,
      station: s.station,
      stationLabel: standard?.label ?? s.station,
      userId: s.userId,
      userName: s.userName,
      planId: s.planId,
      planName: s.planName,
      batchCount: s.batchCount,
      activeMinutes: Math.round(activeMinutes),
      breakMinutes: Math.round(s.breakMinutes),
      bph: Math.round(bph * 10) / 10,
      targetBph,
      minBph,
      status,
      recipes: Array.from(s.recipes.entries()).map(([name, count]) => ({ name, count })),
    });
  }

  dailySessions.sort((a, b) => b.date.localeCompare(a.date) || a.station.localeCompare(b.station));

  const stationSummary = new Map<string, {
    label: string;
    totalBatches: number;
    totalActiveMinutes: number;
    sessionCount: number;
    targetBph: number | null;
    minBph: number | null;
  }>();
  for (const ds of dailySessions) {
    if (!stationSummary.has(ds.station)) {
      stationSummary.set(ds.station, {
        label: ds.stationLabel,
        totalBatches: 0,
        totalActiveMinutes: 0,
        sessionCount: 0,
        targetBph: ds.targetBph,
        minBph: ds.minBph,
      });
    }
    const ss = stationSummary.get(ds.station)!;
    ss.totalBatches += ds.batchCount;
    ss.totalActiveMinutes += ds.activeMinutes;
    ss.sessionCount++;
  }

  const stationSummaries = Array.from(stationSummary.entries()).map(([station, ss]) => ({
    station,
    label: ss.label,
    totalBatches: ss.totalBatches,
    avgBph: ss.totalActiveMinutes > 0
      ? Math.round((ss.totalBatches / (ss.totalActiveMinutes / 60)) * 10) / 10
      : 0,
    sessionCount: ss.sessionCount,
    targetBph: ss.targetBph,
    minBph: ss.minBph,
  }));

  const userSummary = new Map<number, {
    name: string;
    totalBatches: number;
    totalActiveMinutes: number;
    sessionCount: number;
    stations: Set<string>;
  }>();
  for (const ds of dailySessions) {
    if (!ds.userId) continue;
    if (!userSummary.has(ds.userId)) {
      userSummary.set(ds.userId, {
        name: ds.userName,
        totalBatches: 0,
        totalActiveMinutes: 0,
        sessionCount: 0,
        stations: new Set(),
      });
    }
    const us = userSummary.get(ds.userId)!;
    us.totalBatches += ds.batchCount;
    us.totalActiveMinutes += ds.activeMinutes;
    us.sessionCount++;
    us.stations.add(ds.stationLabel);
  }

  const userSummaries = Array.from(userSummary.entries()).map(([userId, us]) => ({
    userId,
    userName: us.name,
    totalBatches: us.totalBatches,
    avgBph: us.totalActiveMinutes > 0
      ? Math.round((us.totalBatches / (us.totalActiveMinutes / 60)) * 10) / 10
      : 0,
    totalActiveMinutes: us.totalActiveMinutes,
    sessionCount: us.sessionCount,
    stations: Array.from(us.stations),
  }));

  const totalBatches = dailySessions.reduce((s, ds) => s + ds.batchCount, 0);
  const totalActiveMinutes = dailySessions.reduce((s, ds) => s + ds.activeMinutes, 0);
  const overallBph = totalActiveMinutes > 0
    ? Math.round((totalBatches / (totalActiveMinutes / 60)) * 10) / 10
    : 0;
  const uniqueDays = new Set(dailySessions.map(ds => ds.date)).size;

  res.json({
    overview: {
      totalBatches,
      totalActiveMinutes,
      overallBph,
      uniqueDays,
      avgBatchesPerDay: uniqueDays > 0 ? Math.round(totalBatches / uniqueDays) : 0,
    },
    stationSummaries,
    userSummaries,
    dailySessions,
  });
});

// ── Packing Speed ──────────────────────────────────────────────────────────
// GET /reports/packing-speed?from=YYYY-MM-DD&to=YYYY-MM-DD
// Uses Shopify fulfilled orders. For each day finds the first and last
// fulfillment timestamp to compute the actual packing window, then calculates
// orders per hour based on that real duration.
router.get("/packing-speed", async (req, res) => {
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;

  if (!from || !to) {
    res.status(400).json({ error: "from and to date parameters are required" });
    return;
  }

  let orders;
  try {
    orders = await getFulfilledOrdersForDateRange(from, to);
  } catch (err) {
    console.error("Packing speed: Shopify fetch failed:", err);
    res.status(502).json({ error: "Unable to fetch fulfillment data from Shopify. Check your Shopify credentials." });
    return;
  }

  // Collect all fulfillment timestamps across all orders, grouped by calendar day (UTC)
  interface DayData {
    date: string;
    count: number;
    timestamps: number[]; // ms epoch for each fulfillment
    orderNames: string[];
  }
  const byDay: Record<string, DayData> = {};

  for (const order of orders) {
    const fuls = order.fulfillments ?? [];
    // If no fulfillment records attached, fall back to the order's created_at date
    const successFuls = fuls.filter(f => f.status === "success" || f.status === "fulfilled");
    const timestamps = successFuls.length > 0
      ? successFuls.map(f => new Date(f.created_at).getTime())
      : [new Date(order.created_at).getTime()];

    for (const ts of timestamps) {
      const day = new Date(ts).toISOString().slice(0, 10);
      if (!byDay[day]) byDay[day] = { date: day, count: 0, timestamps: [], orderNames: [] };
      byDay[day].timestamps.push(ts);
    }
    // Count the order once per day it has activity
    const orderDays = new Set(timestamps.map(ts => new Date(ts).toISOString().slice(0, 10)));
    for (const day of orderDays) {
      if (!byDay[day]) byDay[day] = { date: day, count: 0, timestamps: [], orderNames: [] };
      byDay[day].count += 1;
      byDay[day].orderNames.push(order.name);
    }
  }

  // Build daily rows with actual packing window
  const dailyRows = Object.values(byDay)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(day => {
      const sortedTs = [...day.timestamps].sort((a, b) => a - b);
      const firstTs = sortedTs[0];
      const lastTs = sortedTs[sortedTs.length - 1];
      const windowMs = lastTs - firstTs;
      // Minimum 1-minute window to avoid division by zero; cap denominator at 8 hrs
      const windowHours = windowMs > 60_000 ? windowMs / 3_600_000 : null;
      const ordersPerHour = windowHours != null
        ? Math.round((day.count / windowHours) * 10) / 10
        : null;

      return {
        date: day.date,
        count: day.count,
        firstFulfilledAt: firstTs ? new Date(firstTs).toISOString() : null,
        lastFulfilledAt: lastTs ? new Date(lastTs).toISOString() : null,
        windowMinutes: windowMs > 0 ? Math.round(windowMs / 60_000) : null,
        ordersPerHour,
      };
    });

  const totalOrders = dailyRows.reduce((s, d) => s + d.count, 0);
  const totalDays = dailyRows.length;
  const avgPerDay = totalDays > 0 ? Math.round(totalOrders / totalDays) : 0;

  // Overall orders/hr: total orders divided by total packing time across all days
  const totalWindowHours = dailyRows.reduce((s, d) => {
    if (d.windowMinutes && d.windowMinutes > 1) return s + d.windowMinutes / 60;
    return s;
  }, 0);
  const overallOrdersPerHour = totalWindowHours > 0
    ? Math.round((totalOrders / totalWindowHours) * 10) / 10
    : 0;

  const bestDay = dailyRows.reduce<{ date: string; count: number } | null>(
    (best, d) => (!best || d.count > best.count ? d : best),
    null,
  );

  res.json({
    totalOrders,
    totalDays,
    ordersPerHour: overallOrdersPerHour,
    avgPerDay,
    bestDay,
    dailyRows,
    source: "shopify",
  });
});

export default router;
