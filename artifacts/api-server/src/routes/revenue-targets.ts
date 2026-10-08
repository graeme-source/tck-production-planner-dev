/**
 * Monthly revenue targets — a MINIMUM (one figure, every month) and a
 * STRETCH per month that carries forward until changed (Graeme,
 * 2026-10-08). Objective I.
 *
 * Seen on Numbers (the Month to Date tile, where they're edited) and on
 * Sales & Marketing (read-only revenue pace), so reading is open to the
 * founder and to anyone granted either page. CHANGING them is the
 * founder's alone — requireFounder on every write, 403 for anyone else,
 * whatever the screen shows.
 *
 * Every change goes through applyTargetChanges: one transaction, each change
 * checked against the value the editor saw (409 if it moved underneath),
 * a stretch must stay above the minimum, and a history row per change
 * (who, when, old → new). The rules are lib/revenue-targets (pure, tested).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  applyChanges, diffTargets, formatGbp, isMonthKey, MINIMUM_SETTING_KEY, monthLabel, monthOf, monthsFrom,
  stretchBelowMinimum, targetsForMonths, type TargetChange,
} from "@workspace/revenue-targets";
import { loadRevenueTargetsState } from "../lib/revenue-targets-store";
import { requireFounder } from "../middleware/founder-access";
import { requireFounderArea } from "../middleware/founder-area-access";
import { validate } from "../middleware/validate";
import { isFounderEmail } from "../lib/founder-email";

const router: IRouter = Router();
router.use(requireFounderArea(["founder.numbers", "founder.sales"]));

/** This month plus the next twelve. */
const WINDOW_MONTHS = 13;
const MAX_TARGET = 100_000_000;

function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

const loadState = loadRevenueTargetsState;

/** What both pages read: the minimum, this month and the next 12 with
 *  where each stretch came from, recent history, and may-I-edit. */
async function buildPayload(userId: number) {
  const today = londonToday();
  const currentMonth = monthOf(today);
  const state = await loadState(pool);
  const months = targetsForMonths(monthsFrom(currentMonth, WINDOW_MONTHS), state.minimum, state.rows);

  const setBy = await db.execute<{ month: string; set_by_name: string | null; set_at: string }>(
    sql`SELECT month, set_by_name, set_at::text FROM revenue_targets`,
  );
  const setByMonth = new Map(setBy.rows.map(r => [r.month, { name: r.set_by_name, at: r.set_at }]));

  const history = await db.execute<{
    kind: "minimum" | "stretch"; month: string | null; old_value: number | null; new_value: number | null;
    changed_by_name: string | null; changed_at: string;
  }>(sql`
    SELECT kind, month, old_value::float8 AS old_value, new_value::float8 AS new_value, changed_by_name, changed_at::text
    FROM revenue_target_history ORDER BY changed_at DESC, id DESC LIMIT 20
  `);
  const me = await db.execute<{ email: string | null }>(sql`SELECT email FROM app_users WHERE id = ${userId} LIMIT 1`);

  return {
    today,
    currentMonth,
    minimum: state.minimum,
    months: months.map(m => ({
      ...m,
      setBy: m.stretchSource === "set" ? setByMonth.get(m.month) ?? null : null,
    })),
    /** Every month with its own stretch (the editor resolves carry-forward
     *  from these with the same rules as the server). */
    rows: state.rows,
    history: history.rows.map(h => ({
      kind: h.kind, month: h.month,
      oldValue: h.old_value == null ? null : Number(h.old_value),
      newValue: h.new_value == null ? null : Number(h.new_value),
      changedByName: h.changed_by_name, changedAt: h.changed_at,
    })),
    canEdit: isFounderEmail(me.rows[0]?.email),
  };
}

router.get("/", async (req: Request, res: Response) => {
  try {
    res.json(await buildPayload(req.session.userId!));
  } catch (err) {
    console.error("[revenue-targets] read failed:", err);
    res.status(500).json({ error: "Couldn't load the revenue targets" });
  }
});

class TargetsConflict extends Error {}
class TargetsInvalid extends Error {}

/** Apply a set of changes in one transaction, with history. `from` on each
 *  change must match what's saved now — otherwise someone (or another tab)
 *  changed it after the editor opened, and we refuse rather than overwrite. */
async function applyTargetChanges(userId: number, changes: TargetChange[]): Promise<TargetChange[]> {
  const pg = await pool.connect();
  try {
    await pg.query("BEGIN");
    // One writer at a time: lock the minimum's row (always present).
    await pg.query(`SELECT 1 FROM app_settings WHERE key = $1 FOR UPDATE`, [MINIMUM_SETTING_KEY]);
    const before = await loadState(pg);
    const saved = new Map(before.rows.map(r => [r.month, r.stretch]));

    for (const c of changes) {
      const current = c.kind === "minimum" ? before.minimum : (saved.get(c.month!) ?? null);
      if (current !== c.from) {
        throw new TargetsConflict(
          c.kind === "minimum"
            ? `The minimum is now ${formatGbp(current ?? 0)} — it changed since you opened this. Close and reopen to see the latest.`
            : `${monthLabel(c.month!)}'s stretch changed since you opened this. Close and reopen to see the latest.`,
        );
      }
    }
    const after = applyChanges(before, changes);
    const window = monthsFrom(monthOf(londonToday()), WINDOW_MONTHS);
    const below = stretchBelowMinimum(after, window);
    if (below.length > 0) {
      throw new TargetsInvalid(
        `A stretch target has to be above the minimum (${formatGbp(after.minimum)}) — check ${monthLabel(below[0]!)}${below.length > 1 ? ` and ${below.length - 1} later month${below.length === 2 ? "" : "s"}` : ""}.`,
      );
    }
    // Only what really differs (a no-op change records nothing).
    const real = diffTargets(before, after);

    const me = await pg.query(`SELECT name FROM app_users WHERE id = $1`, [userId]);
    const name: string | null = me.rows[0]?.name ?? null;

    for (const c of real) {
      if (c.kind === "minimum") {
        await pg.query(
          `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [MINIMUM_SETTING_KEY, String(c.to)],
        );
      } else if (c.to == null) {
        await pg.query(`DELETE FROM revenue_targets WHERE month = $1`, [c.month]);
      } else {
        await pg.query(
          `INSERT INTO revenue_targets (month, stretch_target, set_by_id, set_by_name, set_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (month) DO UPDATE SET stretch_target = EXCLUDED.stretch_target,
             set_by_id = EXCLUDED.set_by_id, set_by_name = EXCLUDED.set_by_name, set_at = NOW()`,
          [c.month, c.to, userId, name],
        );
      }
      await pg.query(
        `INSERT INTO revenue_target_history (kind, month, old_value, new_value, changed_by_id, changed_by_name)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [c.kind, c.month, c.from, c.to, userId, name],
      );
    }
    await pg.query("COMMIT");
    return real;
  } catch (err) {
    await pg.query("ROLLBACK").catch(() => { /* the original error is what matters */ });
    throw err;
  } finally {
    pg.release();
  }
}

async function respondWithChanges(req: Request, res: Response, changes: TargetChange[]) {
  try {
    const applied = await applyTargetChanges(req.session.userId!, changes);
    res.json({ applied, targets: await buildPayload(req.session.userId!) });
  } catch (err) {
    if (err instanceof TargetsConflict) { res.status(409).json({ error: err.message }); return; }
    if (err instanceof TargetsInvalid) { res.status(400).json({ error: err.message }); return; }
    console.error("[revenue-targets] save failed:", err);
    res.status(500).json({ error: "Couldn't save the targets — nothing was changed." });
  }
}

const amount = z.number().positive().max(MAX_TARGET);
const monthKey = z.string().refine(isMonthKey, "month must be YYYY-MM");

const ChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("minimum"), month: z.null().optional(), from: amount, to: amount }),
  z.object({ kind: z.literal("stretch"), month: monthKey, from: amount.nullable(), to: amount.nullable() }),
]);
const ChangesBody = z.object({ changes: z.array(ChangeSchema).min(1).max(40) });

/** Several changes at once (the editor's Save, and Undo). */
router.post("/changes", requireFounder, validate(ChangesBody), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof ChangesBody>;
  const changes: TargetChange[] = body.changes.map(c =>
    c.kind === "minimum"
      ? { kind: "minimum", month: null, from: c.from, to: c.to }
      : { kind: "stretch", month: c.month, from: c.from, to: c.to });
  const months = changes.filter(c => c.kind === "stretch").map(c => c.month);
  if (new Set(months).size !== months.length || changes.filter(c => c.kind === "minimum").length > 1) {
    res.status(400).json({ error: "Each target can only appear once in a save." });
    return;
  }
  await respondWithChanges(req, res, changes);
});

const MinimumBody = z.object({ value: amount, expected: amount });
router.put("/minimum", requireFounder, validate(MinimumBody), async (req: Request, res: Response) => {
  const { value, expected } = req.body as z.infer<typeof MinimumBody>;
  await respondWithChanges(req, res, [{ kind: "minimum", month: null, from: expected, to: value }]);
});

const StretchBody = z.object({ value: amount, expected: amount.nullable() });
router.put("/stretch/:month", requireFounder, validate(StretchBody), async (req: Request, res: Response) => {
  const month = String(req.params["month"]);
  if (!isMonthKey(month)) { res.status(400).json({ error: "month must be YYYY-MM" }); return; }
  const { value, expected } = req.body as z.infer<typeof StretchBody>;
  await respondWithChanges(req, res, [{ kind: "stretch", month, from: expected, to: value }]);
});

const ClearBody = z.object({ expected: amount });
router.delete("/stretch/:month", requireFounder, validate(ClearBody), async (req: Request, res: Response) => {
  const month = String(req.params["month"]);
  if (!isMonthKey(month)) { res.status(400).json({ error: "month must be YYYY-MM" }); return; }
  const { expected } = req.body as z.infer<typeof ClearBody>;
  await respondWithChanges(req, res, [{ kind: "stretch", month, from: expected, to: null }]);
});

export type RevenueTargetsPayload = Awaited<ReturnType<typeof buildPayload>>;
export default router;
