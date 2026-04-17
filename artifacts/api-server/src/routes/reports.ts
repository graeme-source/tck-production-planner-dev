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

// Recipe category name for macaroni cheese products. Mac cheese completions are
// split out from calzone completions in KPI reports (1 mac batch_completion
// row = 1 pack because portionsPerBatch=2, packsPerBatch=1).
const MAC_CHEESE_CATEGORY = "Macaroni Cheese";
// Synthetic station type used in KPI reports to represent mac cheese packs
// built at the building tables. Lets mac packs appear as their own row in
// station summaries and daily sessions alongside building_1/building_2.
const MAC_CHEESE_PACKS_STATION = "mac_cheese_packs";

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
  try {
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
      recipeCategory: recipesTable.category,
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

  // For a completion, the station row it contributes to in session/station
  // summaries. Mac cheese items built at building tables get routed to a
  // synthetic "mac_cheese_packs" pseudo-station so calzone batches and mac
  // packs can't distort each other's BPH.
  const effectiveStation = (c: { stationType: string; recipeCategory: string | null }) => {
    if (c.recipeCategory === MAC_CHEESE_CATEGORY && (c.stationType === "building_1" || c.stationType === "building_2")) {
      return MAC_CHEESE_PACKS_STATION;
    }
    return c.stationType;
  };

  const timingStandards = await db.select().from(timingStandardsTable);
  const standardsMap = new Map(timingStandards.map(t => [t.stationType, {
    target: Number(t.targetBatchesPerHour),
    min: Number(t.minBatchesPerHour),
    label: t.stationLabel,
  }]));
  // The synthetic mac cheese pseudo-station has no timing_standards row, so
  // provide a default label. Thresholds stay null (no color coding) until we
  // explicitly configure them.
  standardsMap.set(MAC_CHEESE_PACKS_STATION, { target: 0, min: 0, label: "Mac Cheese Packs" });

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
      breakType: stationBreaksTable.breakType,
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
    const station = effectiveStation(c);
    const key = makeKey(date, station, c.userId, c.planId);
    if (!sessionMap.has(key)) {
      sessionMap.set(key, {
        date,
        station,
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
    const mins = Math.max(0, (b.endedAt.getTime() - b.startedAt.getTime()) / 60000);
    // Breaks taken on a building table apply to both the calzone session and
    // the mac cheese session (same builder, same break window).
    const candidateStations = (b.stationType === "building_1" || b.stationType === "building_2")
      ? [b.stationType, MAC_CHEESE_PACKS_STATION]
      : [b.stationType];
    for (const st of candidateStations) {
      const s = sessionMap.get(makeKey(date, st, b.userId, b.planId));
      if (s) s.breakMinutes += mins;
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

  // Overview KPIs only count building tables (the real production throughput).
  const building1Sessions = dailySessions.filter(ds => ds.station === "building_1");
  const building2Sessions = dailySessions.filter(ds => ds.station === "building_2");

  const sumMinutes = (xs: typeof dailySessions) => xs.reduce((s, ds) => s + ds.activeMinutes, 0);

  const building1Minutes = sumMinutes(building1Sessions);
  const building2Minutes = sumMinutes(building2Sessions);
  const totalActiveMinutes = building1Minutes + building2Minutes;

  // Source of truth for "Total Batches": calzone building completions per
  // recipe, capped at batchesTarget per recipe so inflated completions can't
  // exceed what was actually planned. Mac cheese completions are tracked
  // separately as packs (totalMacPacks) since 1 mac batch = 1 pack.
  const buildingCompletionsByItem = new Map<number, number>();
  const macPacksCompletionsByItem = new Map<number, number>();
  for (const c of completions) {
    if (c.stationType !== "building_1" && c.stationType !== "building_2") continue;
    if (c.recipeCategory === MAC_CHEESE_CATEGORY) {
      macPacksCompletionsByItem.set(c.planItemId, (macPacksCompletionsByItem.get(c.planItemId) ?? 0) + 1);
    } else {
      buildingCompletionsByItem.set(c.planItemId, (buildingCompletionsByItem.get(c.planItemId) ?? 0) + 1);
    }
  }

  // Look up batchesTarget + extraPacksBuilt per plan item to cap calzone
  // completions and accumulate mac packs.
  const planIds = [...new Set(completions.map(c => c.planId))];
  let totalBatches = 0;
  let totalMacPacks = 0;
  if (planIds.length > 0) {
    const planItemRows = await db
      .select({
        id: productionPlanItemsTable.id,
        batchesTarget: productionPlanItemsTable.batchesTarget,
        extraPacksBuilt: productionPlanItemsTable.extraPacksBuilt,
        portionsPerBatch: recipesTable.portionsPerBatch,
        category: recipesTable.category,
      })
      .from(productionPlanItemsTable)
      .innerJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
      .where(inArray(productionPlanItemsTable.planId, planIds));

    for (const pi of planItemRows) {
      if (pi.category === MAC_CHEESE_CATEGORY) {
        // Mac packs: cap at target (1 mac batch_completion row = 1 pack)
        const target = pi.batchesTarget ?? 0;
        const built = macPacksCompletionsByItem.get(pi.id) ?? 0;
        totalMacPacks += Math.min(built, target);
      } else {
        const target = pi.batchesTarget ?? 0;
        const built = buildingCompletionsByItem.get(pi.id) ?? 0;
        totalBatches += Math.min(built, target);
      }
    }
  }

  // overallBph calculated after productionActiveMinutes is computed below

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

    // Deduct the admin-configured break durations (Settings → Break / Lunch minutes)
    // for each break type that was recorded, regardless of logged duration. This keeps
    // the KPI predictable: if a lunch break was taken, we subtract the planned lunch
    // minutes, never the actual logged minutes.
    const [breakSetting] = await db
      .select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, "default_break_minutes"));
    const [lunchSetting] = await db
      .select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, "default_lunch_minutes"));
    const configuredBreakMins = breakSetting ? Number(breakSetting.value) : 15;
    const configuredLunchMins = lunchSetting ? Number(lunchSetting.value) : 45;

    const buildingBreaks = breaks.filter(
      b => (b.stationType === "building_1" || b.stationType === "building_2") && b.endedAt
    );
    const hasLunch = buildingBreaks.some(b => b.breakType === "lunch");
    const hasSnackBreak = buildingBreaks.some(b => b.breakType !== "lunch");
    const totalBreakMins = (hasLunch ? configuredLunchMins : 0) + (hasSnackBreak ? configuredBreakMins : 0);
    productionActiveMinutes = Math.round(Math.max(0, wallClockMinutes - totalBreakMins));
  }

  // Cap per-builder and per-user station summaries for building stations
  // (calzone) and the mac_cheese_packs pseudo-station so they match the
  // capped totals above. Each category caps independently.
  if ((totalBatches > 0 || totalMacPacks > 0) && planIds.length > 0) {
    const planItemTargets = new Map<number, number>();
    const piRows = await db
      .select({ id: productionPlanItemsTable.id, batchesTarget: productionPlanItemsTable.batchesTarget })
      .from(productionPlanItemsTable)
      .where(inArray(productionPlanItemsTable.planId, planIds));
    for (const pi of piRows) planItemTargets.set(pi.id, pi.batchesTarget ?? 0);

    // Count per effective station per plan item (calzone goes to building_*,
    // mac cheese goes to mac_cheese_packs).
    const stationItemCounts = new Map<string, Map<number, number>>();
    const userItemCounts = new Map<number, Map<number, { count: number; isMac: boolean }>>();
    for (const c of completions) {
      if (c.stationType !== "building_1" && c.stationType !== "building_2") continue;
      const station = effectiveStation(c);
      if (!stationItemCounts.has(station)) stationItemCounts.set(station, new Map());
      const sic = stationItemCounts.get(station)!;
      sic.set(c.planItemId, (sic.get(c.planItemId) ?? 0) + 1);
      if (c.userId) {
        if (!userItemCounts.has(c.userId)) userItemCounts.set(c.userId, new Map());
        const uic = userItemCounts.get(c.userId)!;
        const prev = uic.get(c.planItemId);
        uic.set(c.planItemId, {
          count: (prev?.count ?? 0) + 1,
          isMac: c.recipeCategory === MAC_CHEESE_CATEGORY,
        });
      }
    }

    // Cap each station's per-item count at its share of the target. For
    // mac_cheese_packs, the "totalForItem" source is macPacksCompletionsByItem
    // (not buildingCompletionsByItem).
    for (const [station, itemCounts] of stationItemCounts) {
      const totalByItem = station === MAC_CHEESE_PACKS_STATION
        ? macPacksCompletionsByItem
        : buildingCompletionsByItem;
      let cappedTotal = 0;
      for (const [itemId, count] of itemCounts) {
        const totalForItem = totalByItem.get(itemId) ?? count;
        const target = planItemTargets.get(itemId) ?? count;
        const cappedTarget = Math.min(totalForItem, target);
        cappedTotal += totalForItem > 0 ? Math.round((count / totalForItem) * cappedTarget) : 0;
      }
      const ss = stationSummary.get(station);
      if (ss) ss.totalBatches = cappedTotal;
    }

    // Cap each user's building counts. Calzone and mac contributions are
    // both summed into totalBatches since the userSummary doesn't split —
    // the stationSummary is where the split is surfaced.
    for (const [userId, itemCounts] of userItemCounts) {
      let cappedTotal = 0;
      for (const [itemId, { count, isMac }] of itemCounts) {
        const totalByItem = isMac ? macPacksCompletionsByItem : buildingCompletionsByItem;
        const totalForItem = totalByItem.get(itemId) ?? count;
        const target = planItemTargets.get(itemId) ?? count;
        const cappedTarget = Math.min(totalForItem, target);
        cappedTotal += totalForItem > 0 ? Math.round((count / totalForItem) * cappedTarget) : 0;
      }
      const us = userSummary.get(userId);
      if (us) us.totalBatches = cappedTotal;
    }
  }

  // Rebuild summaries with capped counts
  const stationSummariesFinal = Array.from(stationSummary.entries()).map(([station, ss]) => ({
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

  const userSummariesFinal = Array.from(userSummary.entries()).map(([userId, us]) => ({
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

  // BPH = total batches ÷ production active hours (wall clock minus breaks).
  // Calzones and mac packs share the same denominator — same team worked
  // both during the production window.
  const overallBph = productionActiveMinutes > 0
    ? Math.round((totalBatches / (productionActiveMinutes / 60)) * 10) / 10
    : 0;
  const macPacksPerHour = productionActiveMinutes > 0
    ? Math.round((totalMacPacks / (productionActiveMinutes / 60)) * 10) / 10
    : 0;

  res.json({
    overview: {
      totalBatches,
      totalMacPacks,
      totalActiveMinutes: productionActiveMinutes,
      wallClockMinutes,
      overallBph,
      macPacksPerHour,
      productionStartTime,
      productionFinishTime,
    },
    stationSummaries: stationSummariesFinal,
    userSummaries: userSummariesFinal,
    dailySessions,
  });
  } catch (err) {
    console.error("[production-kpis] error:", err);
    res.status(500).json({ error: "Failed to compute production KPIs" });
  }
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

// ──────────────────────────────────────────────────────────────────────────────
// GET /leftover-filling — aggregate leftover filling data per recipe
// ──────────────────────────────────────────────────────────────────────────────
router.get("/leftover-filling", async (req, res) => {
  try {
    const { from, to } = req.query;

    const conditions = [isNotNull(productionPlanItemsTable.leftoverFillingGrams)];
    if (from) conditions.push(gte(productionPlansTable.planDate, String(from)));
    if (to) conditions.push(lte(productionPlansTable.planDate, String(to)));

    const rows = await db
      .select({
        recipeId: productionPlanItemsTable.recipeId,
        recipeName: recipesTable.name,
        planDate: productionPlansTable.planDate,
        leftoverGrams: productionPlanItemsTable.leftoverFillingGrams,
        leftoverComment: productionPlanItemsTable.leftoverFillingComment,
      })
      .from(productionPlanItemsTable)
      .innerJoin(productionPlansTable, eq(productionPlanItemsTable.planId, productionPlansTable.id))
      .innerJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
      .where(and(...conditions))
      .orderBy(recipesTable.name, productionPlansTable.planDate);

    // Aggregate per recipe
    const byRecipe: Record<number, {
      recipeId: number;
      recipeName: string;
      count: number;
      totalGrams: number;
      minGrams: number;
      maxGrams: number;
      entries: { planDate: string; grams: number; comment: string | null }[];
    }> = {};

    for (const row of rows) {
      const g = row.leftoverGrams ?? 0;
      if (!byRecipe[row.recipeId]) {
        byRecipe[row.recipeId] = {
          recipeId: row.recipeId,
          recipeName: row.recipeName ?? "Unknown",
          count: 0,
          totalGrams: 0,
          minGrams: g,
          maxGrams: g,
          entries: [],
        };
      }
      const rec = byRecipe[row.recipeId];
      rec.count++;
      rec.totalGrams += g;
      rec.minGrams = Math.min(rec.minGrams, g);
      rec.maxGrams = Math.max(rec.maxGrams, g);
      rec.entries.push({ planDate: row.planDate, grams: g, comment: row.leftoverComment ?? null });
    }

    const result = Object.values(byRecipe).map(r => ({
      ...r,
      avgGrams: Math.round(r.totalGrams / r.count),
    }));

    res.json(result);
  } catch (err) {
    console.error("leftover-filling report error:", err);
    res.status(500).json({ error: "Failed to load leftover filling data" });
  }
});

export default router;
