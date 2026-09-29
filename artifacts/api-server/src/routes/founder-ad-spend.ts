/**
 * Daily ad spend — the Numbers page's ROAS input (Objective I).
 *
 *   GET /api/founder-focus/ad-spend?date=YYYY-MM-DD
 *   GET /api/founder-focus/ad-spend/range?from=&to=
 *   PUT /api/founder-focus/ad-spend  { date, amount|null }
 *
 * Lived inside founder-focus.ts (the founder's Schedule) until 2026-09-29.
 * Moved out, URLs unchanged, because the Numbers page can now be granted
 * to someone else (founder.numbers) while the Schedule stays the founder's
 * alone. Mounted BEFORE the founder-focus router in routes/index.ts so
 * these paths never reach its founder-only gate.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { requireFounderArea } from "../middleware/founder-area-access";

const router: IRouter = Router();
router.use(requireFounderArea("founder.numbers"));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Daily ad spend (Numbers page) ──────────────────────────────────────────
// One figure per day, feeding the new-customer ROAS panel: yesterday's
// new-customer revenue ÷ this number.
//
// Two ways in. Graeme types it here, or the Meta Marketing API sync writes
// it (lib/meta-ads-sync.ts). `source` says which, and the rule is absolute:
// a hand-entered figure always wins — the sync will not touch a row this
// endpoint wrote. Typing over a synced figure therefore also PINS the day,
// because the row flips to 'manual' and the next sync leaves it alone.
router.get("/", async (req: Request, res: Response) => {
  const date = typeof req.query.date === "string" ? req.query.date : "";
  if (!DATE_RE.test(date)) { res.status(400).json({ error: "date=YYYY-MM-DD required" }); return; }
  const rows = await db.execute<{ amount: string; source: string; synced_at: Date | null }>(sql`
    SELECT amount, source, synced_at FROM founder_ad_spend WHERE spend_date = ${date} LIMIT 1
  `);
  const row = rows.rows[0];
  res.json({
    date,
    amount: row?.amount != null ? Number(row.amount) : null,
    source: row?.source ?? null,
    syncedAt: row?.synced_at ? new Date(row.synced_at).toISOString() : null,
  });
});

// Spend for a span of days, for the rolling seven-day ROAS on the Numbers
// page. Days with no figure recorded are simply absent from `days` — the
// caller must be able to tell "nothing recorded" from "recorded as £0",
// because only the second one can honestly be divided by.
const AD_SPEND_RANGE_QUERY = z.object({
  from: z.string().regex(DATE_RE),
  to: z.string().regex(DATE_RE),
});
// A generous ceiling that still stops a typo asking for a decade of rows.
const AD_SPEND_RANGE_MAX_DAYS = 400;

router.get("/range", async (req: Request, res: Response) => {
  const parsed = AD_SPEND_RANGE_QUERY.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "from and to (YYYY-MM-DD) are required" }); return; }
  const { from, to } = parsed.data;
  if (from > to) { res.status(400).json({ error: "from must not be after to" }); return; }
  const spanDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (spanDays > AD_SPEND_RANGE_MAX_DAYS) {
    res.status(400).json({ error: `Range too long — ${AD_SPEND_RANGE_MAX_DAYS} days maximum` });
    return;
  }
  const rows = await db.execute<{ spend_date: string | Date; amount: string; source: string; synced_at: Date | null }>(sql`
    SELECT spend_date, amount, source, synced_at
    FROM founder_ad_spend
    WHERE spend_date >= ${from} AND spend_date <= ${to}
    ORDER BY spend_date ASC
  `);
  res.json({
    from,
    to,
    days: rows.rows.map((row) => ({
      // spend_date is a DATE column; node-postgres may hand it back as a
      // Date object depending on its parser, so normalise to YYYY-MM-DD.
      date: typeof row.spend_date === "string" ? row.spend_date.slice(0, 10) : new Date(row.spend_date).toISOString().slice(0, 10),
      amount: row.amount != null ? Number(row.amount) : null,
      source: row.source ?? null,
      syncedAt: row.synced_at ? new Date(row.synced_at).toISOString() : null,
    })),
  });
});

router.put("/", async (req: Request, res: Response) => {
  const parsed = z.object({
    date: z.string().regex(DATE_RE),
    // null clears the day's entry (typo recovery). A cleared day is no
    // longer pinned, so a later sync is free to fill it in again.
    amount: z.number().min(0).max(1_000_000).nullable(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "date and a non-negative amount are required" }); return; }
  const { date, amount } = parsed.data;
  if (amount === null) {
    await db.execute(sql`DELETE FROM founder_ad_spend WHERE spend_date = ${date}`);
    res.json({ date, amount: null, source: null, syncedAt: null });
    return;
  }
  await db.execute(sql`
    INSERT INTO founder_ad_spend (spend_date, amount, updated_at, source, synced_at)
    VALUES (${date}, ${amount}, NOW(), 'manual', NULL)
    ON CONFLICT (spend_date) DO UPDATE
      SET amount = ${amount}, updated_at = NOW(), source = 'manual', synced_at = NULL
  `);
  res.json({ date, amount, source: "manual", syncedAt: null });
});

export default router;
