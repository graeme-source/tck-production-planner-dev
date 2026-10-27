/**
 * Prep sessions — the database half shared by routes/prep-sessions.ts (what
 * the prep screens report in the background) and routes/prep-completions.ts
 * (the tick itself). The decisions are pure and tested in
 * lib/prep-session-rules.ts; this file only reads and writes the rows
 * (prep_sessions, prep_session_completions — migration 0312).
 *
 * Every prep tick ends up recorded once for timing, whichever call gets
 * there first: the tick endpoint records it the moment it's saved (so a
 * tick is checked server-side even if the screen's own report never
 * arrives), and the screen's report adds the tin's quantity. A tick with no
 * session open on the item is FLAGGED (flag-and-allow): the tick stands,
 * and a zero-length row marked completed_without_open counts it.
 * Times are the database's clock throughout (UTC sessions, @workspace/db).
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { COMPLETED_WITHOUT_OPEN, MAX_SESSION_MS, completionTiming, isPrepTin, type SessionHead } from "../lib/prep-session-rules";

export type PrepItem = { ingredientId: number | null; subRecipeId: number | null };

/** Epoch milliseconds from the database (float8 carries microseconds). */
export const ms = (v: number | string) => Math.round(Number(v));

export function itemMatch(item: PrepItem) {
  return sql`ingredient_id IS NOT DISTINCT FROM ${item.ingredientId}::int
    AND sub_recipe_id IS NOT DISTINCT FROM ${item.subRecipeId}::int`;
}

/** Re-total a session from its completions: latest completion time, and the
 *  quantity when every completion gave one in the same unit. */
export async function refreshSessionTotals(sessionId: number): Promise<void> {
  await db.execute(sql`
    UPDATE prep_sessions s SET
      completed_at = agg.last_at,
      quantity = agg.qty,
      quantity_unit = agg.unit
    FROM (
      SELECT MAX(completed_at) AS last_at,
             CASE WHEN COUNT(*) > 0 AND COUNT(quantity) = COUNT(*) AND COUNT(DISTINCT quantity_unit) = 1
                  THEN SUM(quantity) END AS qty,
             CASE WHEN COUNT(DISTINCT quantity_unit) = 1 THEN MIN(quantity_unit) END AS unit
        FROM prep_session_completions
       WHERE session_id = ${sessionId}
    ) agg
    WHERE s.id = ${sessionId}
  `);
}

/** The person's real (unflagged) sessions on an item that could own a
 *  completion at `atSql`. */
export async function candidateSessions(
  userId: number, planId: number, item: PrepItem, recipeId: number | null, atSql: ReturnType<typeof sql>,
): Promise<SessionHead[]> {
  const rows = await db.execute<{ id: number; opened_ms: number; closed_ms: number | null }>(sql`
    SELECT id,
           (EXTRACT(EPOCH FROM opened_at) * 1000)::float8 AS opened_ms,
           (EXTRACT(EPOCH FROM closed_at) * 1000)::float8 AS closed_ms
      FROM prep_sessions
     WHERE user_id = ${userId} AND plan_id = ${planId} AND ${itemMatch(item)} AND flag IS NULL
       AND (recipe_id IS NULL OR recipe_id IS NOT DISTINCT FROM ${recipeId}::int)
       AND opened_at <= ${atSql}
       AND opened_at > ${atSql} - make_interval(secs => ${MAX_SESSION_MS / 1000})
     ORDER BY opened_at DESC
     LIMIT 5
  `);
  return rows.rows.map(r => ({ id: r.id, openedAt: ms(r.opened_ms), closedAt: r.closed_ms == null ? null : ms(r.closed_ms) }));
}

/** A tick by the same tuple the prep-completions endpoints key on
 *  (origin-tagged ingredient ticks carry their sub-recipe in sub_recipe_id). */
export async function findTick(
  planId: number, item: PrepItem, recipeId: number, tinNumber: number, subRecipeOriginId: number | null,
): Promise<{ id: number; userId: number | null } | null> {
  const r = await db.execute<{ id: number; user_id: number | null }>(item.ingredientId != null ? sql`
    SELECT id, user_id FROM prep_completions
     WHERE plan_id = ${planId} AND ingredient_id = ${item.ingredientId}
       AND recipe_id = ${recipeId} AND tin_number = ${tinNumber}
       AND COALESCE(sub_recipe_id, 0) = COALESCE(${subRecipeOriginId}::int, 0)
  ` : sql`
    SELECT id, user_id FROM prep_completions
     WHERE plan_id = ${planId} AND sub_recipe_id = ${item.subRecipeId} AND ingredient_id IS NULL
       AND recipe_id = ${recipeId} AND tin_number = ${tinNumber}
  `);
  const row = r.rows[0];
  return row ? { id: row.id, userId: row.user_id } : null;
}

export type TimingResult = "linked" | "flagged" | "not_prep" | "missing";

/**
 * Record one prep tick for timing — idempotent, safe to call from both the
 * tick endpoint and the screen's report. Links it to the ticker's session on
 * the item (lib/prep-session-rules.ts completionTiming), or flags it as
 * completed without opening. A quantity, when given, is kept.
 */
export async function recordTickTiming(
  prepCompletionId: number,
  amount: { quantity?: number | null; unit?: string | null } = {},
): Promise<TimingResult> {
  const quantity = amount.quantity ?? null;
  const unit = amount.unit ?? null;
  const tickRows = await db.execute<{
    plan_id: number; ingredient_id: number | null; sub_recipe_id: number | null; recipe_id: number;
    tin_number: number; user_id: number | null; at_ms: number; linked_session: number | null; flagged: boolean | null;
  }>(sql`
    SELECT pc.plan_id, pc.ingredient_id, pc.sub_recipe_id, pc.recipe_id, pc.tin_number, pc.user_id,
           (EXTRACT(EPOCH FROM pc.completed_at) * 1000)::float8 AS at_ms,
           psc.session_id AS linked_session, (ps.flag IS NOT NULL) AS flagged
      FROM prep_completions pc
      LEFT JOIN prep_session_completions psc ON psc.prep_completion_id = pc.id
      LEFT JOIN prep_sessions ps ON ps.id = psc.session_id
     WHERE pc.id = ${prepCompletionId}
  `);
  const tick = tickRows.rows[0];
  if (!tick) return "missing";
  if (!isPrepTin(Number(tick.tin_number))) return "not_prep";

  // Already recorded (the other call got there first): just add the amount.
  if (tick.linked_session != null) {
    if (quantity != null || unit != null) {
      await db.execute(sql`
        UPDATE prep_session_completions
           SET quantity = COALESCE(${quantity}, quantity), quantity_unit = COALESCE(${unit}, quantity_unit)
         WHERE prep_completion_id = ${prepCompletionId}
      `);
      await refreshSessionTotals(tick.linked_session);
    }
    return tick.flagged ? "flagged" : "linked";
  }

  const item: PrepItem = tick.ingredient_id != null
    ? { ingredientId: tick.ingredient_id, subRecipeId: null }
    : { ingredientId: null, subRecipeId: tick.sub_recipe_id };
  const candidates = tick.user_id != null
    ? await candidateSessions(tick.user_id, tick.plan_id, item, tick.recipe_id,
        sql`(SELECT completed_at FROM prep_completions WHERE id = ${prepCompletionId})`)
    : [];
  const decision = completionTiming(candidates, ms(tick.at_ms));

  if (decision.kind === "link") {
    const linked = await db.execute<{ session_id: number }>(sql`
      INSERT INTO prep_session_completions (session_id, prep_completion_id, recipe_id, quantity, quantity_unit, completed_at)
      SELECT ${decision.sessionId}, pc.id, pc.recipe_id, ${quantity}, ${unit}, pc.completed_at
        FROM prep_completions pc WHERE pc.id = ${prepCompletionId}
      ON CONFLICT (prep_completion_id) DO UPDATE
        SET quantity = COALESCE(EXCLUDED.quantity, prep_session_completions.quantity),
            quantity_unit = COALESCE(EXCLUDED.quantity_unit, prep_session_completions.quantity_unit)
      RETURNING session_id
    `);
    const sessionId = linked.rows[0]?.session_id ?? decision.sessionId;
    await refreshSessionTotals(sessionId);
    return "linked";
  }

  // Nothing open on the item: flag-and-allow. One statement, so a second
  // caller racing this one can't add a second link for the same tick.
  const flagged = await db.execute<{ session_id: number }>(sql`
    WITH tick AS (
      SELECT * FROM prep_completions WHERE id = ${prepCompletionId}
    ), flagged AS (
      INSERT INTO prep_sessions (plan_id, station, ingredient_id, sub_recipe_id, recipe_id, user_id,
                                 opened_at, closed_at, completed_at, flag)
      SELECT plan_id, NULL, ingredient_id, CASE WHEN ingredient_id IS NULL THEN sub_recipe_id END, NULL, user_id,
             completed_at, completed_at, completed_at, ${COMPLETED_WITHOUT_OPEN}
        FROM tick
       WHERE NOT EXISTS (SELECT 1 FROM prep_session_completions WHERE prep_completion_id = ${prepCompletionId})
      RETURNING id
    )
    INSERT INTO prep_session_completions (session_id, prep_completion_id, recipe_id, quantity, quantity_unit, completed_at)
    SELECT flagged.id, tick.id, tick.recipe_id, ${quantity}, ${unit}, tick.completed_at FROM flagged, tick
    ON CONFLICT (prep_completion_id) DO NOTHING
    RETURNING session_id
  `);
  const flaggedSession = flagged.rows[0]?.session_id;
  if (flaggedSession != null) await refreshSessionTotals(flaggedSession);
  return "flagged";
}

/** A finished make flow, timed against the person's session on the
 *  sub-recipe — or flagged, the same way as a tick. */
export async function recordMakeTiming(args: {
  userId: number; planId: number; subRecipeId: number; batches: number; quantity: number | null; unit: string | null;
}): Promise<TimingResult> {
  const item: PrepItem = { ingredientId: null, subRecipeId: args.subRecipeId };
  const now = await db.execute<{ now_ms: number }>(sql`SELECT (EXTRACT(EPOCH FROM NOW()) * 1000)::float8 AS now_ms`);
  const candidates = await candidateSessions(args.userId, args.planId, item, null, sql`NOW()`);
  const decision = completionTiming(candidates, ms(now.rows[0]?.now_ms ?? Date.now()));
  let sessionId: number;
  if (decision.kind === "link") {
    sessionId = decision.sessionId;
  } else {
    const r = await db.execute<{ id: number }>(sql`
      INSERT INTO prep_sessions (plan_id, station, ingredient_id, sub_recipe_id, recipe_id, user_id,
                                 opened_at, closed_at, completed_at, flag)
      VALUES (${args.planId}, NULL, NULL, ${args.subRecipeId}, NULL, ${args.userId}, NOW(), NOW(), NOW(), ${COMPLETED_WITHOUT_OPEN})
      RETURNING id
    `);
    sessionId = r.rows[0]!.id;
  }
  await db.execute(sql`
    INSERT INTO prep_session_completions (session_id, prep_completion_id, recipe_id, quantity, quantity_unit, batches)
    VALUES (${sessionId}, NULL, NULL, ${args.quantity}, ${args.unit}, ${args.batches})
  `);
  await refreshSessionTotals(sessionId);
  return decision.kind === "link" ? "linked" : "flagged";
}
