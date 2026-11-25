/**
 * /api/pnl-tracker — the profit tracker on the founder P&L page (Graeme,
 * 18 Nov 2026; Objective I, finance & reporting). Founder only. Reads
 * Shopify's order mirror, QuickBooks, Planday and the ad spend; writes only
 * its own settings and the account grouping.
 *
 *   GET /predict?from&to         predicted P&L for any days (default the
 *                                last 14), every order costed, and the
 *                                by-size and by-product summaries
 *   GET /compare                 predicted vs QuickBooks for the complete
 *                                months the overheads are averaged over
 *   GET /groups                  QuickBooks accounts and their buckets
 *   PUT /groups                  { name, bucket | null } — null = back to
 *                                its default
 *   GET /settings, PUT /settings { key, value } — box and courier prices,
 *                                months to average
 */
import { Router, type IRouter, type Request, type Response } from "express";
import * as z from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireFounder } from "../middleware/founder-access";
import { validate, validateQuery } from "../middleware/validate";
import { addDaysToDateString, londonDateString } from "../lib/london-time";
import { accountKey, BUCKETS, BUCKET_LABELS, type Bucket } from "../lib/finance/profit-tracker";
import {
  compareMonths, lastCompleteMonths, loadQboBuckets, predict, readTrackerSettings, setAccountBucket,
  TRACKER_SETTINGS, writeTrackerSetting, type TrackerSettingKey,
} from "../lib/finance/profit-tracker-load";

const router: IRouter = Router();
router.use(requireFounder);

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// Every order in the range is costed, so the range is capped. 93 so the
// standard picker's "Last 3 months" always fits (three months back from
// yesterday is at most 93 days, both ends counted).
const MAX_DAYS = 93;

function qboError(res: Response, where: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[pnl-tracker/${where}]`, msg);
  res.status(502).json({ error: /not connected/i.test(msg) ? "QuickBooks isn't connected — connect it under Finance." : `Couldn't work it out: ${msg}` });
}

async function averageMonths(): Promise<string[]> {
  const s = await readTrackerSettings();
  const n = s.overhead_average_months === 6 ? 6 : 3;
  return lastCompleteMonths(londonDateString(), n);
}

const predictQuery = z.object({ from: DATE.optional(), to: DATE.optional() });

router.get("/predict", validateQuery(predictQuery), async (_req: Request, res: Response) => {
  const q = res.locals["query"] as z.infer<typeof predictQuery>;
  const today = londonDateString();
  const to = q.to ?? today;
  const from = q.from ?? addDaysToDateString(to, -13);
  const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (span < 1 || span > MAX_DAYS) {
    res.status(400).json({ error: `Pick between 1 and ${MAX_DAYS} days, the start before the end.` });
    return;
  }
  try {
    const qbo = await loadQboBuckets(await averageMonths());
    res.json(await predict(from, to, qbo.calibration));
  } catch (err) { qboError(res, "predict", err); }
});

router.get("/compare", async (_req: Request, res: Response) => {
  try {
    const qbo = await loadQboBuckets(await averageMonths());
    res.json({ months: await compareMonths(qbo), calibration: qbo.calibration });
  } catch (err) { qboError(res, "compare", err); }
});

router.get("/groups", async (_req: Request, res: Response) => {
  try {
    const qbo = await loadQboBuckets(await averageMonths());
    res.json({
      months: qbo.months,
      buckets: BUCKETS.map(b => ({ key: b, label: BUCKET_LABELS[b] })),
      accounts: qbo.accounts,
      totals: qbo.totals,
      calibration: qbo.calibration,
    });
  } catch (err) { qboError(res, "groups", err); }
});

const groupBody = z.object({
  name: z.string().trim().min(1).max(200),
  bucket: z.enum(BUCKETS).nullable(),
});

router.put("/groups", validate(groupBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof groupBody>;
  const who = await db.execute<{ name: string }>(sql`SELECT name FROM app_users WHERE id = ${req.session.userId ?? 0}`);
  await setAccountBucket(b.name, accountKey(b.name), b.bucket as Bucket | null, who.rows[0]?.name ?? null);
  res.json({ ok: true });
});

router.get("/settings", async (_req: Request, res: Response) => {
  res.json(await readTrackerSettings());
});

const settingBody = z.object({
  key: z.enum(Object.keys(TRACKER_SETTINGS) as [TrackerSettingKey, ...TrackerSettingKey[]]),
  value: z.number().min(0).max(100000),
}).refine(b => b.key !== "overhead_average_months" || b.value === 3 || b.value === 6, "Average over 3 or 6 months");

router.put("/settings", validate(settingBody), async (req: Request, res: Response) => {
  const b = req.body as { key: TrackerSettingKey; value: number };
  await writeTrackerSetting(b.key, b.value);
  res.json(await readTrackerSettings());
});

export default router;
