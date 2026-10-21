/**
 * The Leaner-board rows, ranked (Objective E). Moved out of
 * GET /api/improvements/scoreboard on 2026-10-21 so the daily improvement
 * check-in can say "you're 3rd on the Leaner-board" from exactly the same
 * ranking the board shows — one source, never two that drift.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { CREDIT_PAIRS } from "../lib/improvement-credits-data";
import { leanerBoardRows } from "../lib/leaner-board";
import { rankLeanerBoard } from "../lib/improvement-score";
import { loadImprovementScores } from "./improvement-score";

export interface LeanerBoardRow {
  userId: number | null;
  name: string;
  count: number;
  creditsAll: number;
  signedOff: number;
  lastAt: Date | null;
  credits30: number;
  improvements30: number;
  shifts30: number | null;
  scorePct: number | null;
}

export async function loadLeanerBoard(): Promise<LeanerBoardRow[]> {
  // `signed_off` counts only what a manager actually approved. Everything
  // completed before sign-off existed was retro-credited by migration 0059
  // so the tallies started from real history — but it was never approved by
  // anyone, and a screen that calls it "approved" is telling a small lie
  // (Graeme spotted exactly this, 2026-08-26).
  //
  // Every credited person counts the improvement in full — something
  // Graeme did with Bodan is one on each of their tallies (migration
  // 0125). CREDIT_PAIRS is the credit rows plus the lead, de-duplicated.
  const result = await db.execute<{ user_id: number | null; name: string | null; email: string | null; n: number; credits_all: number; signed_off: number; last_at: Date | null }>(sql`
    WITH pairs AS (${CREDIT_PAIRS})
    SELECT p.user_id,
           COALESCE(u.name, 'Unknown') AS name,
           u.email,
           COUNT(*)::int AS n,
           SUM(s.credit_weight)::int AS credits_all,
           COUNT(s.approved_at)::int AS signed_off,
           MAX(s.approved_at) AS last_at
      FROM pairs p
      JOIN improvement_submissions s ON s.id = p.improvement_id
      LEFT JOIN app_users u ON u.id = p.user_id
     WHERE s.progress_status = 'complete'
     GROUP BY p.user_id, u.name, u.email
     ORDER BY n DESC, name ASC
  `);
  // The Leaner-board leaves the founder off (Graeme, 2026-10-01).
  const board = leanerBoardRows(result.rows ?? []);
  // Both figures over the same rolling 30 London days (Graeme,
  // 2026-10-12: "I want the percentage, and I want the number of
  // improvements as well"). Ranked by CREDITS since 2026-10-21 — a ×2 or
  // ×3 now lifts you up the board — the score breaking ties; the plain
  // counts and the all-time tallies stay on each row.
  const scores = await loadImprovementScores(board.map(r => Number(r.user_id)).filter(n => n > 0));
  return rankLeanerBoard(board.map(r => {
    const sc = r.user_id != null ? scores.byUser.get(Number(r.user_id)) : undefined;
    return {
      userId: r.user_id,
      name: r.name ?? "Unknown",
      count: Number(r.n),
      creditsAll: Number(r.credits_all ?? r.n),
      signedOff: Number(r.signed_off),
      lastAt: r.last_at,
      credits30: sc?.credits ?? 0,
      improvements30: sc?.improvements ?? 0,
      shifts30: sc?.shifts ?? null,
      scorePct: sc?.scorePct ?? null,
    };
  }));
}
