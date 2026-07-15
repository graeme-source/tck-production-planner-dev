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
import { londonDateString, londonEndOfDay } from "../lib/london-time";
import { getStandardBreakConfig, computeBatchesPerHour, aggregateBph } from "../lib/batches-per-hour";

// Recipe category name for macaroni cheese products. Mac cheese is a separate
// product line and is excluded from the batches-per-hour KPI entirely.
const MAC_CHEESE_CATEGORY = "Macaroni Cheese";

const router: IRouter = Router();

router.get("/breaks", async (req, res) => {
  const { from, to } = req.query;

  const conditions = [isNotNull(stationBreaksTable.endedAt)];
  if (from) conditions.push(gte(stationBreaksTable.startedAt, new Date(String(from))));
  if (to) {
    conditions.push(lte(stationBreaksTable.startedAt, londonEndOfDay(new Date(String(to)))));
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
  const defaultLunchMinutes = lunchSetting ? Number(lunchSetting.value) : 35;

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

// ── Production KPIs (builder batches/hour) ─────────────────────────────────
// One calculation, defined in lib/batches-per-hour: calzone building
// completions only (mac cheese ignored entirely), window = first→last
// completion per London day, standard break lengths deducted when the
// window spans them. The same function produces the team number, each
// builder's number, and each day's number — they can no longer diverge.
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

    const conditions: any[] = [
      sql`${batchCompletionsTable.stationType} IN ('building_1','building_2')`,
      // IS DISTINCT FROM so a NULL category still counts as "not mac cheese"
      sql`${recipesTable.category} IS DISTINCT FROM ${MAC_CHEESE_CATEGORY}`,
    ];
    if (from) conditions.push(sql`${batchCompletionsTable.completedAt} >= ${new Date(String(from)).toISOString()}`);
    if (to) conditions.push(sql`${batchCompletionsTable.completedAt} <= ${londonEndOfDay(new Date(String(to))).toISOString()}`);

    const completions = await db
      .select({
        completedAt: batchCompletionsTable.completedAt,
        userId: batchCompletionsTable.userId,
        userName: usersTable.name,
        planId: productionPlanItemsTable.planId,
        planDate: productionPlansTable.planDate,
        planName: productionPlansTable.name,
        buildingFinishedAt: productionPlansTable.buildingFinishedAt,
        recipeName: recipesTable.name,
      })
      .from(batchCompletionsTable)
      .innerJoin(productionPlanItemsTable, eq(batchCompletionsTable.planItemId, productionPlanItemsTable.id))
      .innerJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
      .innerJoin(productionPlansTable, eq(productionPlanItemsTable.planId, productionPlansTable.id))
      .leftJoin(usersTable, eq(batchCompletionsTable.userId, usersTable.id))
      .where(and(...conditions));

    const breakConfig = await getStandardBreakConfig();

    // Target/min thresholds: the two building lines share one standard —
    // building_1's row is the canonical one.
    const timingStandards = await db.select().from(timingStandardsTable);
    const buildingStandard =
      timingStandards.find(t => t.stationType === "building_1") ??
      timingStandards.find(t => t.stationType === "building_2");
    const targetBph = buildingStandard ? Number(buildingStandard.targetBatchesPerHour) || null : null;
    const minBph = buildingStandard ? Number(buildingStandard.minBatchesPerHour) || null : null;
    const statusFor = (bph: number | null): "above" | "on-target" | "below" | "unknown" => {
      if (bph == null || targetBph == null || minBph == null) return "unknown";
      if (bph >= targetBph) return "above";
      if (bph >= minBph) return "on-target";
      return "below";
    };

    // Group by London day (planDate when set — plans are day-scoped).
    type DayGroup = {
      planId: number;
      planName: string;
      finishedAt: Date | null;
      times: Date[];
      recipes: Map<string, number>;
      users: Map<number, { name: string; times: Date[] }>;
    };
    const dayMap = new Map<string, DayGroup>();
    for (const c of completions) {
      const date = c.planDate ?? londonDateString(c.completedAt);
      let g = dayMap.get(date);
      if (!g) {
        g = { planId: c.planId, planName: c.planName, finishedAt: c.buildingFinishedAt ?? null, times: [], recipes: new Map(), users: new Map() };
        dayMap.set(date, g);
      }
      g.times.push(c.completedAt);
      g.recipes.set(c.recipeName, (g.recipes.get(c.recipeName) ?? 0) + 1);
      if (c.userId != null) {
        let u = g.users.get(c.userId);
        if (!u) {
          u = { name: c.userName ?? "Unknown", times: [] };
          g.users.set(c.userId, u);
        }
        u.times.push(c.completedAt);
      }
    }

    const dayResults = new Map<string, ReturnType<typeof computeBatchesPerHour>>();
    const dailyDetail: Array<{
      date: string;
      planId: number;
      planName: string;
      batches: number;
      windowStart: string | null;
      windowEnd: string | null;
      finishSource: "marked" | "last-batch";
      wallClockMinutes: number;
      morningBreakDeducted: boolean;
      lunchBreakDeducted: boolean;
      breakMinutesDeducted: number;
      activeMinutes: number;
      bph: number | null;
      status: "above" | "on-target" | "below" | "unknown";
      recipes: Array<{ name: string; count: number }>;
      builders: Array<{
        userId: number;
        userName: string;
        batches: number;
        activeMinutes: number;
        breakMinutesDeducted: number;
        bph: number | null;
        status: "above" | "on-target" | "below" | "unknown";
      }>;
    }> = [];

    // Per-builder accumulation across the range — same method, the
    // builder's own first→last completion window each day.
    const builderTotals = new Map<number, {
      name: string;
      totalBatches: number;
      totalActiveMinutes: number;
      daysWorked: number;
    }>();

    for (const [date, g] of dayMap) {
      const day = computeBatchesPerHour(g.times, breakConfig, { finishedAt: g.finishedAt });
      dayResults.set(date, day);

      const builders = Array.from(g.users.entries()).map(([userId, u]) => {
        const r = computeBatchesPerHour(u.times, breakConfig);
        const bt = builderTotals.get(userId) ?? { name: u.name, totalBatches: 0, totalActiveMinutes: 0, daysWorked: 0 };
        bt.totalBatches += r.batches;
        bt.totalActiveMinutes += r.activeMinutes;
        bt.daysWorked++;
        builderTotals.set(userId, bt);
        return {
          userId,
          userName: u.name,
          batches: r.batches,
          activeMinutes: r.activeMinutes,
          breakMinutesDeducted: r.breakMinutesDeducted,
          bph: r.batchesPerHour,
          status: statusFor(r.batchesPerHour),
        };
      }).sort((a, b) => b.batches - a.batches);

      dailyDetail.push({
        date,
        planId: g.planId,
        planName: g.planName,
        batches: day.batches,
        windowStart: day.windowStartAt?.toISOString() ?? null,
        windowEnd: day.windowEndAt?.toISOString() ?? null,
        finishSource: g.finishedAt ? ("marked" as const) : ("last-batch" as const),
        wallClockMinutes: day.wallClockMinutes,
        morningBreakDeducted: day.morningBreakDeducted,
        lunchBreakDeducted: day.lunchBreakDeducted,
        breakMinutesDeducted: day.breakMinutesDeducted,
        activeMinutes: day.activeMinutes,
        bph: day.batchesPerHour,
        status: statusFor(day.batchesPerHour),
        recipes: Array.from(g.recipes.entries()).map(([name, count]) => ({ name, count })),
        builders,
      });
    }

    dailyDetail.sort((a, b) => b.date.localeCompare(a.date));

    const overall = aggregateBph(Array.from(dayResults.values()));
    const latestDay = dailyDetail[0] ?? null;

    const builders = Array.from(builderTotals.entries()).map(([userId, bt]) => ({
      userId,
      userName: bt.name,
      totalBatches: bt.totalBatches,
      totalActiveMinutes: bt.totalActiveMinutes,
      daysWorked: bt.daysWorked,
      bph: bt.totalActiveMinutes >= 1
        ? Math.round((bt.totalBatches / (bt.totalActiveMinutes / 60)) * 10) / 10
        : null,
      status: statusFor(bt.totalActiveMinutes >= 1
        ? Math.round((bt.totalBatches / (bt.totalActiveMinutes / 60)) * 10) / 10
        : null),
    })).sort((a, b) => b.totalBatches - a.totalBatches);

    res.json({
      overview: {
        totalBatches: overall.totalBatches,
        totalActiveMinutes: overall.totalActiveMinutes,
        overallBph: overall.batchesPerHour,
        uniqueDays: dailyDetail.length,
        avgBatchesPerDay: dailyDetail.length > 0
          ? Math.round((overall.totalBatches / dailyDetail.length) * 10) / 10
          : 0,
        // Start/finish cards show the most recent day in the range.
        productionStartTime: latestDay?.windowStart ?? null,
        productionFinishTime: latestDay?.windowEnd ?? null,
        wallClockMinutes: latestDay?.wallClockMinutes ?? 0,
        targetBph,
        minBph,
      },
      breakConfig: {
        morningMinutes: breakConfig.morning.minutes,
        lunchMinutes: breakConfig.lunch.minutes,
        morningAnchorMinutes: breakConfig.morning.anchorMinutes,
        lunchAnchorMinutes: breakConfig.lunch.anchorMinutes,
      },
      builders,
      dailyDetail,
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
  // YYYY-MM-DD as seen in London — order tags follow the kitchen's
  // wall-clock day, not Railway's UTC.
  return londonDateString(d);
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

    const IDLE_THRESHOLD_MS = 10 * 60 * 1000;

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

// ──────────────────────────────────────────────────────────────────────────────
// GET /batch-weights — oven batch weight log + HACCP cooling durations
//
// Returns every batch_weight_records row in [from, to] joined with recipe and
// plan name, plus per-recipe-per-day aggregates for cooling time and weight
// variance. Powers the HACCP Cooling & Weights report tab.
// ──────────────────────────────────────────────────────────────────────────────
router.get("/batch-weights", async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) { res.status(400).json({ error: "from and to dates required (YYYY-MM-DD)" }); return; }

  const rows = await db.execute(sql`
    SELECT
      bwr.id,
      bwr.plan_id,
      bwr.plan_item_id,
      bwr.recipe_id,
      bwr.batch_sequence,
      bwr.tray_weight_g,
      bwr.portion_weight_g,
      bwr.pack_size,
      bwr.target_weight_g,
      bwr.actual_weight_g,
      bwr.variance_g,
      bwr.tolerance_under_g,
      bwr.tolerance_over_g,
      bwr.within_tolerance,
      bwr.is_last_batch_of_recipe,
      bwr.chill_end_at,
      bwr.chilled_via,
      bwr.recorded_at,
      r.name       AS recipe_name,
      r.color      AS recipe_color,
      r.category   AS recipe_category,
      p.name       AS plan_name,
      p.plan_date  AS plan_date,
      u_weigh.name AS weighed_by_name,
      u_chill.name AS chilled_by_name
    FROM batch_weight_records bwr
    JOIN production_plans p   ON p.id = bwr.plan_id
    JOIN recipes r            ON r.id = bwr.recipe_id
    LEFT JOIN app_users u_weigh ON u_weigh.id = bwr.user_id
    LEFT JOIN app_users u_chill ON u_chill.id = bwr.chilled_by_user_id
    WHERE p.plan_date >= ${from}::date
      AND p.plan_date <= ${to}::date
    ORDER BY p.plan_date DESC, bwr.recorded_at DESC
  `);

  const records = (rows.rows as Array<Record<string, unknown>>).map(r => ({
    id: Number(r["id"]),
    planId: Number(r["plan_id"]),
    planItemId: Number(r["plan_item_id"]),
    recipeId: Number(r["recipe_id"]),
    recipeName: (r["recipe_name"] as string) ?? null,
    recipeColor: (r["recipe_color"] as string) ?? null,
    recipeCategory: (r["recipe_category"] as string) ?? null,
    planName: (r["plan_name"] as string) ?? null,
    planDate: r["plan_date"] ? String(r["plan_date"]).slice(0, 10) : null,
    batchSequence: Number(r["batch_sequence"]),
    trayWeightG: Number(r["tray_weight_g"]),
    portionWeightG: Number(r["portion_weight_g"]),
    packSize: Number(r["pack_size"]),
    targetWeightG: Number(r["target_weight_g"]),
    actualWeightG: Number(r["actual_weight_g"]),
    varianceG: Number(r["variance_g"]),
    toleranceUnderG: Number(r["tolerance_under_g"]),
    toleranceOverG: Number(r["tolerance_over_g"]),
    withinTolerance: Boolean(r["within_tolerance"]),
    isLastBatchOfRecipe: Boolean(r["is_last_batch_of_recipe"]),
    chillEndAt: r["chill_end_at"] ? new Date(r["chill_end_at"] as string).toISOString() : null,
    chilledVia: (r["chilled_via"] as string) ?? null,
    weighedByName: (r["weighed_by_name"] as string) ?? null,
    chilledByName: (r["chilled_by_name"] as string) ?? null,
    recordedAt: new Date(r["recorded_at"] as string).toISOString(),
  }));

  // Cooling summary: one row per (plan, recipe) for last-batch records that
  // have a chill-end time. Duration is chill_end − chill_start minutes.
  type CoolingRow = {
    planId: number; planDate: string | null; planName: string | null;
    recipeId: number; recipeName: string | null; recipeColor: string | null;
    chillStartAt: string; chillEndAt: string; chilledVia: string | null;
    chilledByName: string | null; durationMinutes: number;
  };
  const cooling: CoolingRow[] = [];
  for (const r of records) {
    if (!r.isLastBatchOfRecipe || !r.chillEndAt) continue;
    const start = new Date(r.recordedAt).getTime();
    const end = new Date(r.chillEndAt).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    cooling.push({
      planId: r.planId,
      planDate: r.planDate,
      planName: r.planName,
      recipeId: r.recipeId,
      recipeName: r.recipeName,
      recipeColor: r.recipeColor,
      chillStartAt: r.recordedAt,
      chillEndAt: r.chillEndAt,
      chilledVia: r.chilledVia,
      chilledByName: r.chilledByName,
      durationMinutes: Math.round((end - start) / 60000),
    });
  }

  // Variance summary per recipe across the range.
  type VarianceStat = {
    recipeId: number; recipeName: string | null; recipeColor: string | null;
    count: number; mean: number; min: number; max: number; stdev: number;
    withinToleranceCount: number;
  };
  const byRecipe = new Map<number, { name: string | null; color: string | null; vs: number[]; withinCount: number }>();
  for (const r of records) {
    const cur = byRecipe.get(r.recipeId) ?? { name: r.recipeName, color: r.recipeColor, vs: [], withinCount: 0 };
    cur.vs.push(r.varianceG);
    if (r.withinTolerance) cur.withinCount += 1;
    byRecipe.set(r.recipeId, cur);
  }
  const variance: VarianceStat[] = [];
  for (const [recipeId, v] of byRecipe.entries()) {
    const n = v.vs.length;
    if (n === 0) continue;
    const mean = v.vs.reduce((a, b) => a + b, 0) / n;
    const sq = v.vs.reduce((a, b) => a + (b - mean) ** 2, 0);
    const stdev = n > 1 ? Math.sqrt(sq / (n - 1)) : 0;
    variance.push({
      recipeId,
      recipeName: v.name,
      recipeColor: v.color,
      count: n,
      mean: Math.round(mean * 10) / 10,
      min: Math.min(...v.vs),
      max: Math.max(...v.vs),
      stdev: Math.round(stdev * 10) / 10,
      withinToleranceCount: v.withinCount,
    });
  }

  // Settings snapshot (chill target temp is a fixed HACCP target the report
  // shows alongside cooling rows).
  const settingsRows = await db.select().from(appSettingsTable).where(inArray(appSettingsTable.key, [
    "tray_weight_g", "chill_target_temp_c", "weight_tolerance_under_g", "weight_tolerance_over_g",
  ]));
  const settingsMap: Record<string, string> = {};
  for (const sr of settingsRows) settingsMap[sr.key] = sr.value;

  res.json({
    settings: {
      trayWeightG: Number(settingsMap["tray_weight_g"] ?? 36),
      chillTargetTempC: Number(settingsMap["chill_target_temp_c"] ?? 4),
      toleranceUnderG: Number(settingsMap["weight_tolerance_under_g"] ?? 0),
      toleranceOverG: Number(settingsMap["weight_tolerance_over_g"] ?? 0),
    },
    records,
    cooling,
    variance,
  });
});

export default router;
