/**
 * The Business → Bonus calculator (Graeme, 29 Oct 2026): the founder's own,
 * behind his private PIN — "I don't want Tommy to have access to it".
 * requireFounder (no grant opens it, not even founder.sales) and
 * requirePeopleUnlock (423 until the private PIN is entered) on every route.
 *
 * The scheme's numbers live in founder_settings (key staff_bonus_scheme),
 * which only founder routes read — never app_settings, whose GET is open to
 * every signed-in user. The maths is client-side (lib/staff-bonus.ts); this
 * only stores the numbers and hands over the month targets. Objective I.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { addMonths, monthOf, targetsForMonths } from "@workspace/revenue-targets";
import { requireFounder } from "../middleware/founder-access";
import { requirePeopleUnlock } from "../middleware/people-unlock";
import { validate } from "../middleware/validate";
import { loadRevenueTargetsState } from "../lib/revenue-targets-store";
import { londonDateString } from "../lib/london-time";

const router: IRouter = Router();
router.use(requireFounder, requirePeopleUnlock);

const KEY = "staff_bonus_scheme";

export const SchemeBody = z.object({
  atMinimum: z.number().min(0).max(100_000),
  atStretch: z.number().min(0).max(100_000),
  curve: z.number().min(0.1).max(5),
  step: z.number().min(0).max(10_000_000),
  perStep: z.number().min(0).max(100_000),
  maxBonus: z.number().min(0).max(100_000),
  profitFloorPct: z.number().min(0).max(100),
  employerNiPct: z.number().min(0).max(100),
}).strict();

router.get("/scheme", async (_req: Request, res: Response) => {
  const row = (await db.execute<{ value: string; updated_at: string | null }>(
    sql`SELECT value, updated_at FROM founder_settings WHERE key = ${KEY} LIMIT 1`,
  )).rows[0];
  let scheme: unknown = null;
  try { scheme = row ? JSON.parse(row.value) : null; } catch { scheme = null; }
  const targets = await loadRevenueTargetsState();
  const thisMonth = monthOf(londonDateString());
  const months = [-2, -1, 0, 1, 2, 3].map(n => addMonths(thisMonth, n));
  res.json({
    scheme,
    savedAt: row?.updated_at ?? null,
    thisMonth,
    months: targetsForMonths(months, targets.minimum, targets.rows).map(t => ({ month: t.month, minimum: t.minimum, stretch: t.stretch })),
  });
});

router.put("/scheme", validate(SchemeBody), async (req: Request, res: Response) => {
  const parsed = SchemeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid scheme", details: parsed.error.flatten() }); return; }
  await db.execute(sql`
    INSERT INTO founder_settings (key, value, updated_at) VALUES (${KEY}, ${JSON.stringify(parsed.data)}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);
  res.json({ ok: true, savedAt: new Date().toISOString() });
});

export default router;
