/**
 * Prep sessions — capture how long prep really takes (Graeme, 27 Oct 2026;
 * Objectives C and I). Written in the background by the prep screens
 * (production-planner hooks/use-prep-session-capture.ts): never shown to the
 * team, never waited on. Read by the founder-only report (routes/prep-times.ts).
 *
 *   POST /api/prep-sessions/open
 *        { planId, station, ingredientId | subRecipeId, recipeId?, deviceId? }
 *        → { sessionId, continued }   (sessionId null = not recorded, e.g. a draft plan)
 *        Carries on the person's latest session on the item, or starts one
 *        (lib/prep-session-rules.ts decideOpen).
 *   POST /api/prep-sessions/:id/close → { ok }
 *        The person moved off the item. A session that completed nothing is
 *        then "closed without completing".
 *   POST /api/prep-sessions/complete → { result: linked | flagged | not_prep | missing }
 *        { kind: "tick", planId, ingredientId | subRecipeId, recipeId, tinNumber,
 *          subRecipeOriginId?, quantity?, unit? }
 *            the tick the screen has just made through the existing
 *            /production-plans/:id/prep-completions flow (routes/prep-
 *            completions.ts, which has normally recorded it for timing
 *            already): adds the tin's amount.
 *        { kind: "make", planId, subRecipeId, batches, quantity?, unit? }
 *            a finished sub-recipe make flow (no prep_completions row).
 *        A completion with no session open on the item is FLAGGED, not
 *        refused (flag-and-allow — services/prep-session-store.ts).
 *   POST /api/prep-sessions/untick { planId, ingredientId | subRecipeId } → { ok }
 *        After an undo: the link went with the prep_completions row (ON DELETE
 *        CASCADE); this re-totals the sessions on the item.
 *
 * open and complete record work against a person, so they sit inside the
 * daily PIN lock (lib/pin-enforce.ts); close and untick are like undo and
 * don't. The screens send these quietly — a refusal never raises the PIN pad.
 * Times are the database's clock throughout (UTC sessions, @workspace/db).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import * as z from "zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { validate } from "../middleware/validate";
import { PREP_SESSION_STATIONS, decideOpen, prepItemOf, type SessionHead } from "../lib/prep-session-rules";
import {
  findTick, itemMatch, ms, recordMakeTiming, recordTickTiming, refreshSessionTotals,
} from "../services/prep-session-store";

const router: IRouter = Router();

const id = z.number().int().positive();
const itemFields = {
  ingredientId: id.nullish(),
  subRecipeId: id.nullish(),
};
const quantityFields = {
  quantity: z.number().finite().nonnegative().max(1_000_000).nullish(),
  unit: z.string().trim().min(1).max(20).nullish(),
};

const OpenBody = z.object({
  planId: id,
  station: z.enum(PREP_SESSION_STATIONS),
  ...itemFields,
  recipeId: id.nullish(),
  deviceId: z.string().trim().min(1).max(64).nullish(),
});

const CompleteBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("tick"),
    planId: id,
    ...itemFields,
    recipeId: id,
    tinNumber: z.number().int().min(0).max(10_000),
    subRecipeOriginId: id.nullish(),
    ...quantityFields,
  }),
  z.object({
    kind: z.literal("make"),
    planId: id,
    subRecipeId: id,
    batches: z.number().finite().positive().max(10_000),
    ...quantityFields,
  }),
]);

const UntickBody = z.object({ planId: id, ...itemFields });

const ParamsId = z.object({ id: z.coerce.number().int().positive() });

const FK_VIOLATION = "23503";
const pgCode = (err: unknown) => (err as { code?: string } | null)?.code;

router.post("/open", validate(OpenBody), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof OpenBody>;
  const item = prepItemOf(body);
  if (!item) { res.status(400).json({ error: "Give exactly one of ingredientId or subRecipeId" }); return; }
  const userId = req.session.userId!;
  const recipeId = body.recipeId ?? null;
  try {
    const plan = await db.execute<{ status: string }>(sql`SELECT status FROM production_plans WHERE id = ${body.planId}`);
    if (!plan.rows[0]) { res.status(404).json({ error: "Plan not found" }); return; }
    // Draft plans take no ticks, so a session there could never complete.
    if (plan.rows[0].status === "draft") { res.json({ sessionId: null, continued: false }); return; }

    const found = await db.execute<{ now_ms: number; id: number | null; opened_ms: number | null; closed_ms: number | null }>(sql`
      SELECT (EXTRACT(EPOCH FROM NOW()) * 1000)::float8 AS now_ms, s.id, s.opened_ms, s.closed_ms
        FROM (SELECT 1) one
        LEFT JOIN LATERAL (
          SELECT id,
                 (EXTRACT(EPOCH FROM opened_at) * 1000)::float8 AS opened_ms,
                 (EXTRACT(EPOCH FROM closed_at) * 1000)::float8 AS closed_ms
            FROM prep_sessions
           WHERE user_id = ${userId} AND plan_id = ${body.planId} AND ${itemMatch(item)}
             AND recipe_id IS NOT DISTINCT FROM ${recipeId}::int AND flag IS NULL
           ORDER BY opened_at DESC
           LIMIT 1
        ) s ON TRUE
    `);
    const row = found.rows[0];
    const latest: SessionHead | null = row?.id != null && row.opened_ms != null
      ? { id: row.id, openedAt: ms(row.opened_ms), closedAt: row.closed_ms == null ? null : ms(row.closed_ms) }
      : null;
    const decision = decideOpen(latest, ms(row?.now_ms ?? Date.now()));

    if (decision.kind === "continue") {
      const pauses = decision.pause ? sql`pauses || ${JSON.stringify([decision.pause])}::jsonb` : sql`pauses`;
      await db.execute(sql`
        UPDATE prep_sessions
           SET closed_at = NULL,
               pauses = ${pauses},
               device_id = COALESCE(${body.deviceId ?? null}, device_id)
         WHERE id = ${decision.sessionId}
      `);
      res.json({ sessionId: decision.sessionId, continued: true });
      return;
    }

    const inserted = await db.execute<{ id: number }>(sql`
      INSERT INTO prep_sessions (plan_id, station, ingredient_id, sub_recipe_id, recipe_id, user_id, device_id)
      VALUES (${body.planId}, ${body.station}, ${item.ingredientId}, ${item.subRecipeId}, ${recipeId}, ${userId}, ${body.deviceId ?? null})
      RETURNING id
    `);
    res.status(201).json({ sessionId: inserted.rows[0]!.id, continued: false });
  } catch (err) {
    if (pgCode(err) === FK_VIOLATION) { res.status(404).json({ error: "That prep item or recipe no longer exists" }); return; }
    console.error("[prep-sessions] open failed:", err);
    res.status(500).json({ error: "Couldn't record the prep session" });
  }
});

router.post("/:id/close", async (req: Request, res: Response) => {
  const params = ParamsId.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid session id" }); return; }
  try {
    // Any signed-in user may close a session: on a shared iPad the next
    // person's screen closes what was open before they signed in. Closing
    // records nothing against anyone.
    await db.execute(sql`
      UPDATE prep_sessions SET closed_at = NOW()
       WHERE id = ${params.data.id} AND closed_at IS NULL
    `);
    res.json({ ok: true });
  } catch (err) {
    console.error("[prep-sessions] close failed:", err);
    res.status(500).json({ error: "Couldn't close the prep session" });
  }
});

router.post("/complete", validate(CompleteBody), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof CompleteBody>;
  const userId = req.session.userId!;
  try {
    if (body.kind === "tick") {
      const item = prepItemOf(body);
      if (!item) { res.status(400).json({ error: "Give exactly one of ingredientId or subRecipeId" }); return; }
      // The tick the screen just made, found by its natural key. The tick
      // endpoint has normally recorded it already; this adds the tin's amount.
      const tick = await findTick(body.planId, item, body.recipeId, body.tinNumber, body.subRecipeOriginId ?? null);
      // Only the person who ticked it gets the time.
      if (!tick || tick.userId !== userId) { res.json({ result: "missing" }); return; }
      const result = await recordTickTiming(tick.id, { quantity: body.quantity ?? null, unit: body.unit ?? null });
      res.json({ result });
      return;
    }

    // A finished make flow — timed against the session open on the
    // sub-recipe, or flagged as made without opening it.
    const result = await recordMakeTiming({
      userId, planId: body.planId, subRecipeId: body.subRecipeId, batches: body.batches,
      quantity: body.quantity ?? null, unit: body.unit ?? null,
    });
    res.json({ result });
  } catch (err) {
    console.error("[prep-sessions] complete failed:", err);
    res.status(500).json({ error: "Couldn't link the prep completion" });
  }
});

router.post("/untick", validate(UntickBody), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof UntickBody>;
  const item = prepItemOf(body);
  if (!item) { res.status(400).json({ error: "Give exactly one of ingredientId or subRecipeId" }); return; }
  try {
    // Whoever undid it, every session on the item for this plan is re-totalled
    // (only the one that owned the tick actually changes).
    const sessions = await db.execute<{ id: number }>(sql`
      SELECT id FROM prep_sessions WHERE plan_id = ${body.planId} AND ${itemMatch(item)}
    `);
    for (const s of sessions.rows) await refreshSessionTotals(s.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("[prep-sessions] untick failed:", err);
    res.status(500).json({ error: "Couldn't re-total the prep session" });
  }
});

export default router;
