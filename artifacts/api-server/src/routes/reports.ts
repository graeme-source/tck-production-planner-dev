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
import { getOrdersByTag } from "../services/shopify";

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

  // For reporting, use batchesTarget as the source of truth for "Total Batches",
  // plus fractional batches for any extra packs built.
  // This prevents extraPacksBuilt rounding up to whole batches and inflating the count.
  const planIds = [...new Set(completions.map(c => c.planId))];
  let trueBatchTotal = 0;
  if (planIds.length > 0) {
    const planItemRows = await db
      .select({
        batchesTarget: productionPlanItemsTable.batchesTarget,
        extraPacksBuilt: productionPlanItemsTable.extraPacksBuilt,
        portionsPerBatch: recipesTable.portionsPerBatch,
      })
      .from(productionPlanItemsTable)
      .innerJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
      .where(inArray(productionPlanItemsTable.planId, planIds));

    for (const pi of planItemRows) {
      const bt = pi.batchesTarget ?? 0;
      const extras = pi.extraPacksBuilt ?? 0;
      const ppb = Math.max(1, Math.floor((Number(pi.portionsPerBatch) || 10) / 2));
      // Add batchesTarget + fractional batch for extras (e.g. 6 extras / 5 packs per batch = 1.2)
      trueBatchTotal += bt + (extras > 0 ? extras / ppb : 0);
    }
    trueBatchTotal = Math.round(trueBatchTotal * 10) / 10;
  }

  // Overview KPIs only count building tables (the real production throughput).
  //
  // "Combined" BPH = the SUM of each building table's own rate, not the
  // pooled average. Two builders running in parallel at 8/hr and 10/hr
  // report 18/hr (the production line's actual throughput), not the 9/hr
  // you'd get by pooling batches and minutes together first.
  const building1Sessions = dailySessions.filter(ds => ds.station === "building_1");
  const building2Sessions = dailySessions.filter(ds => ds.station === "building_2");
  const buildingSessions = [...building1Sessions, ...building2Sessions];

  const sumBatches = (xs: typeof dailySessions) => xs.reduce((s, ds) => s + ds.batchCount, 0);
  const sumMinutes = (xs: typeof dailySessions) => xs.reduce((s, ds) => s + ds.activeMinutes, 0);
  const bphOf = (batches: number, minutes: number) => minutes > 0 ? batches / (minutes / 60) : 0;

  const building1Batches = sumBatches(building1Sessions);
  const building1Minutes = sumMinutes(building1Sessions);
  const building2Batches = sumBatches(building2Sessions);
  const building2Minutes = sumMinutes(building2Sessions);

  const building1Bph = bphOf(building1Batches, building1Minutes);
  const building2Bph = bphOf(building2Batches, building2Minutes);
  const overallBph = Math.round((building1Bph + building2Bph) * 10) / 10;

  const totalBatches = building1Batches + building2Batches;
  const totalActiveMinutes = building1Minutes + building2Minutes;
  const uniqueDays = new Set(buildingSessions.map(ds => ds.date)).size;

  // Production start/finish from earliest and latest building completion timestamps
  const buildingCompletions = completions.filter(c => c.stationType === "building_1" || c.stationType === "building_2");
  let productionStartTime: string | null = null;
  let productionFinishTime: string | null = null;
  let wallClockMinutes = 0;
  let productionActiveMinutes = 0;
  if (buildingCompletions.length > 0) {
    const times = buildingCompletions.map(c => c.completedAt.getTime());
    const earliest = new Date(Math.min(...times));
    const latest = new Date(Math.max(...times));
    productionStartTime = earliest.toISOString();
    productionFinishTime = latest.toISOString();
    wallClockMinutes = Math.round((latest.getTime() - earliest.getTime()) / 60000);

    // Merge all building-station breaks within the production window into
    // non-overlapping intervals, then subtract from wall-clock time.
    const buildingBreaks = breaks.filter(
      b => (b.stationType === "building_1" || b.stationType === "building_2") && b.endedAt
    );
    const intervals: { start: number; end: number }[] = [];
    for (const b of buildingBreaks) {
      const s = Math.max(new Date(b.startedAt!).getTime(), earliest.getTime());
      const e = Math.min(new Date(b.endedAt!).getTime(), latest.getTime());
      if (e > s) intervals.push({ start: s, end: e });
    }
    // Sort and merge overlapping intervals
    intervals.sort((a, b) => a.start - b.start);
    const merged: { start: number; end: number }[] = [];
    for (const iv of intervals) {
      const last = merged[merged.length - 1];
      if (last && iv.start <= last.end) {
        last.end = Math.max(last.end, iv.end);
      } else {
        merged.push({ ...iv });
      }
    }
    const totalBreakMins = merged.reduce((s, iv) => s + (iv.end - iv.start) / 60000, 0);
    productionActiveMinutes = Math.round(Math.max(0, wallClockMinutes - totalBreakMins));
  }

  // Use trueBatchTotal (batchesTarget + fractional extras) instead of raw completion count
  // for the overview. This prevents extraPacksBuilt inflating each recipe by a whole batch.
  const displayBatches = trueBatchTotal || totalBatches; // fallback to raw count if no plan items found
  const displayBph = productionActiveMinutes > 0
    ? Math.round((displayBatches / (productionActiveMinutes / 60)) * 10) / 10
    : overallBph;

  res.json({
    overview: {
      totalBatches: displayBatches,
      totalActiveMinutes: productionActiveMinutes,
      wallClockMinutes,
      overallBph: displayBph,
      uniqueDays,
      avgBatchesPerDay: uniqueDays > 0 ? Math.round(displayBatches / uniqueDays) : 0,
      productionStartTime,
      productionFinishTime,
    },
    stationSummaries,
    userSummaries,
    dailySessions,
  });
});

// ── Packing Speed ──────────────────────────────────────────────────────────
// GET /reports/packing-speed?from=YYYY-MM-DD&to=YYYY-MM-DD
// Uses the same tag-based Shopify query as the weekly-orders bar chart
// (orders tagged by delivery date = dispatch day + 1), so both views agree.
// For each dispatch day finds fulfilled orders, extracts fulfillment
// timestamps to compute the packing window, then calculates orders/hour.

function toDateTag(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

router.get("/packing-speed", async (req, res) => {
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;

  if (!from || !to) {
    res.status(400).json({ error: "from and to date parameters are required" });
    return;
  }

  try {
    const fromDate = new Date(from + "T00:00:00");
    const toDate = new Date(to + "T00:00:00");
    const dayCount = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1);

    interface DayData {
      date: string;
      count: number;
      timestamps: number[];
      orderNames: string[];
    }
    const byDay: Record<string, DayData> = {};

    const tagFetches = Array.from({ length: dayCount }, (_, i) => {
      const dispatchDay = new Date(fromDate);
      dispatchDay.setDate(fromDate.getDate() + i);
      const deliveryDay = new Date(dispatchDay);
      deliveryDay.setDate(dispatchDay.getDate() + 1);
      const dispatchStr = toDateTag(dispatchDay);
      const deliveryTag = toDateTag(deliveryDay);
      return { dispatchStr, deliveryTag };
    });

    const results = await Promise.all(
      tagFetches.map(async ({ dispatchStr, deliveryTag }) => {
        const orders = await getOrdersByTag(deliveryTag);
        const fulfilled = orders.filter(o => o.fulfillment_status === "fulfilled");
        return { dispatchStr, fulfilled };
      })
    );

    for (const { dispatchStr, fulfilled } of results) {
      if (fulfilled.length === 0) continue;
      if (!byDay[dispatchStr]) {
        byDay[dispatchStr] = { date: dispatchStr, count: 0, timestamps: [], orderNames: [] };
      }
      const day = byDay[dispatchStr];
      day.count += fulfilled.length;

      for (const order of fulfilled) {
        day.orderNames.push(order.name);
        const fuls = order.fulfillments ?? [];
        const successFuls = fuls.filter(f => f.status === "success" || f.status === "fulfilled");
        if (successFuls.length > 0) {
          for (const f of successFuls) {
            day.timestamps.push(new Date(f.created_at).getTime());
          }
        } else {
          day.timestamps.push(new Date(order.created_at).getTime());
        }
      }
    }

    const IDLE_THRESHOLD_MS = 5 * 60 * 1000;

    const dailyRows = Object.values(byDay)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(day => {
        const sortedTs = [...day.timestamps].sort((a, b) => a - b);
        const firstTs = sortedTs[0];
        const lastTs = sortedTs[sortedTs.length - 1];
        const windowMs = lastTs - firstTs;

        let idleMs = 0;
        let idleBreaks = 0;
        for (let i = 1; i < sortedTs.length; i++) {
          const gap = sortedTs[i] - sortedTs[i - 1];
          if (gap > IDLE_THRESHOLD_MS) {
            idleMs += gap;
            idleBreaks++;
          }
        }

        const activeMs = Math.max(0, windowMs - idleMs);
        const activeHours = activeMs > 60_000 ? activeMs / 3_600_000 : null;
        const ordersPerHour = activeHours != null
          ? Math.round((day.count / activeHours) * 10) / 10
          : null;

        return {
          date: day.date,
          count: day.count,
          firstFulfilledAt: firstTs ? new Date(firstTs).toISOString() : null,
          lastFulfilledAt: lastTs ? new Date(lastTs).toISOString() : null,
          windowMinutes: windowMs > 0 ? Math.round(windowMs / 60_000) : null,
          activeMinutes: activeMs > 0 ? Math.round(activeMs / 60_000) : null,
          idleMinutes: idleMs > 0 ? Math.round(idleMs / 60_000) : null,
          idleBreaks,
          ordersPerHour,
        };
      });

    const totalOrders = dailyRows.reduce((s, d) => s + d.count, 0);
    const totalDays = dailyRows.length;
    const avgPerDay = totalDays > 0 ? Math.round(totalOrders / totalDays) : 0;

    const totalActiveHours = dailyRows.reduce((s, d) => {
      if (d.activeMinutes && d.activeMinutes > 1) return s + d.activeMinutes / 60;
      return s;
    }, 0);
    const overallOrdersPerHour = totalActiveHours > 0
      ? Math.round((totalOrders / totalActiveHours) * 10) / 10
      : 0;
    const totalIdleMinutes = dailyRows.reduce((s, d) => s + (d.idleMinutes ?? 0), 0);

    const busiestDay = dailyRows.reduce<{ date: string; count: number } | null>(
      (best, d) => (!best || d.count > best.count ? { date: d.date, count: d.count } : best),
      null,
    );

    const rowsWithSpeed = dailyRows.filter(d => d.ordersPerHour != null);
    const fastestDay = rowsWithSpeed.reduce<{ date: string; ordersPerHour: number } | null>(
      (best, d) => (!best || (d.ordersPerHour ?? 0) > best.ordersPerHour ? { date: d.date, ordersPerHour: d.ordersPerHour! } : best),
      null,
    );
    const slowestDay = rowsWithSpeed.reduce<{ date: string; ordersPerHour: number } | null>(
      (worst, d) => (!worst || (d.ordersPerHour ?? Infinity) < worst.ordersPerHour ? { date: d.date, ordersPerHour: d.ordersPerHour! } : worst),
      null,
    );

    const totalActiveMinutes = dailyRows.reduce((s, d) => s + (d.activeMinutes ?? 0), 0);

    res.json({
      totalOrders,
      totalDays,
      ordersPerHour: overallOrdersPerHour,
      avgPerDay,
      busiestDay,
      fastestDay,
      slowestDay,
      totalIdleMinutes,
      totalActiveMinutes,
      dailyRows,
      source: "shopify",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Packing speed error:", msg);
    res.status(502).json({ error: "Unable to fetch fulfillment data from Shopify." });
  }
});

export default router;
