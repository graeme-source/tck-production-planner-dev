/**
 * The daily improvement check-in — loading and saving (Objectives E and H).
 * The rules are pure in lib/daily-checkin.ts; the score maths is the
 * Leaner-board's own (lib/improvement-score.ts via loadImprovementScores),
 * so the card and the board can never disagree.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { CREDIT_PAIRS } from "../lib/improvement-credits-data";
import { improvementTotals } from "../lib/improvement-score";
import { londonDateString } from "../lib/london-time";
import { firstNameOf } from "../lib/order-reschedule";
import {
  boardPlace, checkinDay, isCheckinDue, nudgeLine, promptsForDay, teamIdeasForDay,
  type CheckinChoice, type CheckinPrompt, type TeamIdea, type TeamIdeaRow,
} from "../lib/daily-checkin";
import { loadImprovementScores } from "./improvement-score";
import { loadLeanerBoard } from "./leaner-board";

export interface CheckinStatus {
  day: string;
  due: boolean;
  /** Only filled in when due — the card's content. */
  card: null | {
    firstName: string;
    window: { from: string; to: string };
    scorePct: number | null;
    shifts30: number | null;
    credits30: number;
    improvements30: number;
    great30: number;
    substantial30: number;
    /** All-time count, so a "waiting" message can say first vs next. */
    countAll: number;
    board: { place: number; of: number } | null;
    prompts: CheckinPrompt[];
    nudge: { term: string; nutshell: string } | null;
    /** Other people's recent improvements and ideas, to spark one (2026-10-26). */
    teamIdeas: TeamIdea[];
  };
}

/** Other people's improvements and ideas from the last 30 days, for the card. */
async function loadTeamIdeaRows(): Promise<TeamIdeaRow[]> {
  const rows = await db.execute<{
    id: number; title: string; station: string; by_name: string | null; by_ids: number[] | null;
    done: boolean; photo_id: number | null; at: Date | string;
  }>(sql`
    WITH pairs AS (${CREDIT_PAIRS})
    SELECT s.id, s.title, s.station,
           COALESCE(s.credited_to_name, s.submitted_by_name) AS by_name,
           ARRAY_REMOVE(ARRAY_AGG(DISTINCT p.user_id) || ARRAY[s.submitted_by], NULL) AS by_ids,
           s.progress_status = 'complete' AS done,
           (SELECT a.id FROM improvement_attachments a
             WHERE a.improvement_id = s.id AND a.kind = 'image'
             ORDER BY (a.phase = 'after') DESC NULLS LAST, a.id DESC LIMIT 1) AS photo_id,
           COALESCE(s.done_at, s.created_at) AS at
      FROM improvement_submissions s
      LEFT JOIN pairs p ON p.improvement_id = s.id
     WHERE s.type = 'improvement'
       AND s.progress_status IN ('complete', 'submitted_for_review')
       AND COALESCE(s.done_at, s.created_at) >= NOW() - INTERVAL '30 days'
     GROUP BY s.id
  `);
  return (rows.rows ?? []).map(r => ({
    id: Number(r.id), title: r.title, station: r.station, byName: r.by_name,
    byUserIds: (r.by_ids ?? []).map(Number), done: !!r.done,
    photoId: r.photo_id == null ? null : Number(r.photo_id),
    at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
  }));
}

export async function loadCheckinStatus(userId: number, now: Date = new Date()): Promise<CheckinStatus> {
  const day = checkinDay(now);
  const ack = await db.execute<{ day: string }>(sql`
    SELECT day::text AS day FROM user_daily_checkins WHERE user_id = ${userId} AND day = ${day}::date
  `);
  const due = isCheckinDue(ack.rows?.[0]?.day ?? null, day);
  if (!due) return { day, due, card: null };

  const userRow = await db.execute<{ name: string | null }>(sql`SELECT name FROM app_users WHERE id = ${userId}`);
  const scores = await loadImprovementScores([userId]);
  const mine = scores.byUser.get(userId);

  // Their own improvements, for the ×2 / ×3 counts in the window and the
  // all-time count (first vs next). One row per improvement.
  const mineRows = await db.execute<{ id: number; credit_weight: number; done: Date | string }>(sql`
    WITH pairs AS (${CREDIT_PAIRS})
    SELECT DISTINCT s.id, s.credit_weight, COALESCE(s.done_at, s.approved_at, s.created_at) AS done
      FROM pairs p
      JOIN improvement_submissions s ON s.id = p.improvement_id
     WHERE s.progress_status = 'complete' AND p.user_id = ${userId}
  `);
  const rows = (mineRows.rows ?? []).map(r => ({
    id: Number(r.id),
    weight: Number(r.credit_weight),
    doneDate: londonDateString(r.done instanceof Date ? r.done : new Date(r.done)),
  }));
  const window30 = improvementTotals(rows, scores.window);

  // The board's place is a nice-to-have: if Planday or the query trips,
  // the card still shows without it.
  let board: { place: number; of: number } | null = null;
  try {
    board = boardPlace(await loadLeanerBoard(), userId);
  } catch (err) {
    console.warn("[daily-checkin] Leaner-board place unavailable:", err);
  }

  return {
    day,
    due,
    card: {
      firstName: firstNameOf(userRow.rows?.[0]?.name ?? null, ""),
      window: scores.window,
      scorePct: mine?.scorePct ?? null,
      shifts30: mine?.shifts ?? null,
      credits30: mine?.credits ?? 0,
      improvements30: mine?.improvements ?? 0,
      great30: window30.great,
      substantial30: window30.substantial,
      countAll: rows.length,
      board,
      prompts: promptsForDay(userId, day),
      nudge: nudgeLine(),
      // A nice-to-have: the card still shows if this trips.
      teamIdeas: teamIdeasForDay(await loadTeamIdeaRows().catch(err => {
        console.warn("[daily-checkin] team ideas unavailable:", err);
        return [] as TeamIdeaRow[];
      }), userId, day),
    },
  };
}

/**
 * Record today's acknowledgement. Idempotent: a second tap, a second
 * device, or a retry after a dropped connection all leave the first row
 * as it was and still answer "done".
 */
export async function acknowledgeCheckin(
  userId: number,
  input: { choice: CheckinChoice; scoreShown: number | null; creditsShown: number | null },
  now: Date = new Date(),
): Promise<{ day: string; alreadyAcknowledged: boolean }> {
  const day = checkinDay(now);
  const result = await db.execute<{ user_id: number }>(sql`
    INSERT INTO user_daily_checkins (user_id, day, score_shown, credits_shown, choice)
    VALUES (${userId}, ${day}::date, ${input.scoreShown}, ${input.creditsShown}, ${input.choice})
    ON CONFLICT (user_id, day) DO NOTHING
    RETURNING user_id
  `);
  return { day, alreadyAcknowledged: (result.rows ?? []).length === 0 };
}
