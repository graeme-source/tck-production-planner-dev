/**
 * Factory-number forecast for the Create / Edit Plan screens (Graeme,
 * 15 Oct 2026). Objective C — the upper limit beside the safety margin.
 *
 *   GET /factory-forecast?planDate=YYYY-MM-DD
 *       { despatches: per despatch before the plan day ends — predicted late
 *         packs + 80% range + how it was worked out; total; recipeShares
 *         (recipeId → share of the last 7 days' calzone sales); emails due;
 *         thresholds }. The screen combines it with its own live rows
 *         (forecastFactoryNumber) so editing batches updates instantly.
 *   GET /factory-forecast/settings   { thresholds }
 *   PUT /factory-forecast/settings   manager+: the six thresholds (autosaved)
 *
 * Maths: @workspace/stock-prediction (late-orders.ts, factory-forecast.ts).
 * Data: lib/factory-forecast-data.ts (orders cache READ ONLY, Klaviyo READ
 * ONLY, email plan).
 */
import { Router, type IRouter } from "express";
import * as z from "zod";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import {
  combineLateForecasts, despatchesBeforePlanEnd, forecastLateOrders, indexOrdersByDate,
  orderCutoffMs, recipeSalesShares, addDays, thresholdsInOrder, type FactoryThresholds,
} from "@workspace/stock-prediction";
import { loadEmailWindow, loadFactoryThresholds, loadForecastOrders, saveFactoryThresholds } from "../lib/factory-forecast-data";
import { londonDateString } from "../lib/london-time";
import { getNonDispatchDates, getPreviousDispatchDay } from "./production-plans";

const router: IRouter = Router();

const Query = z.object({ planDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

router.get("/", async (req, res) => {
  const q = Query.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: "planDate query param required (YYYY-MM-DD)" }); return; }
  const { planDate } = q.data;
  const now = Date.now();
  const today = londonDateString(new Date(now));
  const skip = await getNonDispatchDates();
  const wd = new Date(`${today}T12:00:00Z`).getUTCDay();
  const despatchDays = despatchesBeforePlanEnd({
    today,
    planDate,
    dispatch1: getPreviousDispatchDay(planDate, skip),
    todayIsDespatchDay: wd >= 1 && wd <= 5 && !skip.has(today),
  });
  const deliveries = despatchDays.map(d => addDays(d, 1));
  const lastCutoff = Math.max(now, ...deliveries.map(d => orderCutoffMs(d)));

  const [{ orders, lines }, emailWindow, thresholds] = await Promise.all([
    loadForecastOrders(),
    loadEmailWindow(now, lastCutoff),
    loadFactoryThresholds(),
  ]);
  const byDate = indexOrdersByDate(orders);
  const despatches = despatchDays.map((despatchDate, i) => {
    const deliveryDate = deliveries[i];
    const cutoff = orderCutoffMs(deliveryDate);
    const emailsInWindow = emailWindow.emails.filter(e => e.at <= cutoff).length;
    const f = forecastLateOrders({ byDate, deliveryDate, now, emailsInWindow, typicalEmailsPerHour: emailWindow.typicalPerHour });
    return { despatchDate, ...f, cutoffAt: new Date(f.cutoffAt).toISOString() };
  });
  const total = combineLateForecasts(despatches);
  res.json({
    planDate,
    generatedAt: new Date(now).toISOString(),
    despatches,
    total,
    lastCutoffAt: new Date(lastCutoff).toISOString(),
    emails: emailWindow.emails.map(e => ({ at: new Date(e.at).toISOString(), name: e.name, source: e.source })),
    klaviyoConnected: emailWindow.klaviyoConnected,
    recipeShares: recipeSalesShares(lines, now),
    thresholds,
  });
});

router.get("/settings", async (_req, res) => {
  res.json({ thresholds: await loadFactoryThresholds() });
});

const n = z.number().int().min(0).max(20_000);
const SettingsBody = z.object({
  targetLow: n, targetHigh: n, warnAt: n, maxAt: n, lowAmber: n, lowRed: n,
}).refine(t => thresholdsInOrder(t as FactoryThresholds), {
  message: "Keep them in order: too low ≤ low ≤ target from ≤ target to ≤ warning ≤ freezing",
});

router.put("/settings", requireManagerOrAdmin, validate(SettingsBody), async (req, res) => {
  await saveFactoryThresholds(req.body as FactoryThresholds);
  res.json({ thresholds: await loadFactoryThresholds() });
});

export default router;
