/**
 * Team efficiency analytics (Objective I; feeds E/G).
 *
 *   GET /api/team-efficiency?range=30d|3m|6m|12m   managers and admins
 *   PUT /api/team-efficiency/settings/:key          founder only
 *
 * CONFIDENTIAL: pounds and R go to the founder account ONLY (exact email
 * match, isFounderEmail). Everyone else gets viewerReport() — rebuilt from
 * an allow-list of percentage/pack/order fields — so the server never sends
 * them a £ figure, whatever the page does.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireManagerOrAdmin } from "../middleware/roles";
import { requireFounder } from "../middleware/founder-access";
import { validate, validateQuery } from "../middleware/validate";
import { isFounderEmail } from "../lib/founder-email";
import { londonDateString } from "../lib/london-time";
import { addDaysIso } from "../lib/team-efficiency-labour";
import { buildReport, viewerReport, rangeFrom, type RangeKey, type StoredDay } from "../lib/team-efficiency-report";
import { SETTING_SCHEMAS, isSettingKey, NEEDS_RECOMPUTE } from "../lib/team-efficiency-settings";
import type { DayFlag, DayStatus } from "../lib/team-efficiency-day";
import { loadSettings, restateAll, recomputeHistory, jobMeta, isJobRunning } from "../services/team-efficiency-job";

const router: IRouter = Router();

const reportQuery = z.object({ range: z.enum(["30d", "3m", "6m", "12m"]).default("3m") });

async function viewerIsFounder(req: Request): Promise<boolean> {
  const userId = req.session.userId;
  if (!userId) return false;
  const r = await db.execute<{ email: string | null }>(sql`SELECT email FROM app_users WHERE id = ${userId} LIMIT 1`);
  return isFounderEmail(r.rows[0]?.email);
}

const num = (x: unknown) => Number(x) || 0;
const numOrNull = (x: unknown) => (x == null ? null : Number(x));
const json = <T>(x: unknown): T => (typeof x === "string" ? JSON.parse(x) : x) as T;

async function storedDays(since: string): Promise<StoredDay[]> {
  const r = await db.execute<Record<string, unknown>>(sql`
    SELECT date::text AS date, status, flags, packs_by_line, eight_pack_bags, orders_despatched, packs_despatched,
           efficiency_pct, ratio, value_credited, value_made_net, value_despatched_net, labour_cost, paid_hours
    FROM team_efficiency_days WHERE date >= ${since} ORDER BY date
  `);
  return r.rows.map(x => ({
    date: String(x.date),
    status: String(x.status) as DayStatus,
    flags: json<DayFlag[]>(x.flags) ?? [],
    packsByLine: json<Record<string, number>>(x.packs_by_line) ?? {},
    eightPackBags: num(x.eight_pack_bags),
    ordersDespatched: num(x.orders_despatched),
    packsDespatched: num(x.packs_despatched),
    efficiencyPct: numOrNull(x.efficiency_pct),
    ratio: numOrNull(x.ratio),
    valueCredited: num(x.value_credited),
    valueMadeNet: num(x.value_made_net),
    valueDespatchedNet: num(x.value_despatched_net),
    labourCost: num(x.labour_cost),
    paidHours: num(x.paid_hours),
  }));
}

async function tableReady(): Promise<boolean> {
  const r = await db.execute<{ ok: string | null }>(sql`SELECT to_regclass('public.team_efficiency_days')::text AS ok`);
  return Boolean(r.rows[0]?.ok);
}

router.get("/", requireManagerOrAdmin, validateQuery(reportQuery), async (req: Request, res: Response) => {
  try {
    if (!(await tableReady())) {
      res.json({ ready: false, founder: false });
      return;
    }
    const { range } = res.locals["query"] as { range: RangeKey };
    const today = londonDateString();
    const to = addDaysIso(today, -1);
    const from = rangeFrom(range, today);
    const [settings, days, meta, founder] = await Promise.all([
      loadSettings(),
      // A fortnight before the range so its first days have a rolling figure.
      storedDays(addDaysIso(from, -21)),
      jobMeta(),
      viewerIsFounder(req),
    ]);
    const full = buildReport(days, settings.standardRatio, from, to);
    const lines = [...new Set(days.flatMap(d => Object.keys(d.packsByLine)))].sort();

    if (!founder) {
      res.json({ ready: true, founder: false, range, report: viewerReport(full), lines, meta });
      return;
    }
    const cats = await db.execute<{ category: string }>(sql`
      SELECT DISTINCT category FROM recipes WHERE category IS NOT NULL AND category <> '' ORDER BY 1
    `);
    res.json({
      ready: true, founder: true, range, report: full, lines, meta,
      settings: {
        standard: { ratio: settings.standardRatio, setOn: settings.standardSetOn },
        despatchShare: settings.despatchShare,
        discountRates: settings.discountRates,
        eightPackFactor: settings.eightPackFactor,
        linePositions: settings.linePositions,
        categories: cats.rows.map(c => c.category),
      },
    });
  } catch (err) {
    console.error("[team-efficiency] report failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Couldn't load team efficiency" });
  }
});

const settingBody = z.object({ value: z.unknown() });

router.put("/settings/:key", requireFounder, validate(settingBody), async (req: Request, res: Response) => {
  const key = String(req.params["key"] ?? "");
  if (!isSettingKey(key)) {
    res.status(404).json({ error: "Unknown setting" });
    return;
  }
  const parsed = SETTING_SCHEMAS[key].safeParse((req.body as { value: unknown }).value);
  if (!parsed.success) {
    res.status(400).json({ error: "That value isn't allowed", details: parsed.error.flatten() });
    return;
  }
  try {
    await db.execute(sql`
      INSERT INTO team_efficiency_settings (key, value, updated_at, updated_by)
      VALUES (${key}, ${JSON.stringify(parsed.data)}::jsonb, NOW(), ${req.session.userId ?? null})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by
    `);
    if (NEEDS_RECOMPUTE.has(key)) {
      const started = recomputeHistory();
      res.json({ ok: true, recomputing: started, busy: !started && isJobRunning() });
      return;
    }
    const restated = await restateAll();
    res.json({ ok: true, restated });
  } catch (err) {
    console.error("[team-efficiency] settings save failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Couldn't save that setting" });
  }
});

export default router;
