/**
 * The daily improvement check-in — the server's pure rules (Graeme,
 * 2026-10-21; Objectives E and H):
 *
 *   "When any person logs in for the first time each day, give them a
 *    review of their improvement score and encourage them to find just one
 *    small improvement today. They have to acknowledge it before they can
 *    do anything else in the app."
 *
 * WHEN: the card is due for a person when they have no acknowledgement for
 * TODAY'S LONDON DAY (user_daily_checkins, migration 0212). The day is the
 * London calendar day, so it rolls over at UK midnight in both GMT and BST
 * — never an hour early because the server runs in UTC. Stored per user,
 * not per device, so acknowledging on one iPad clears it everywhere, and a
 * second person PIN-switching onto the same iPad gets their own card.
 *
 * WHAT: the score numbers come from lib/improvement-score.ts (the
 * Leaner-board's own maths); the "find one" examples are the Eight Wastes
 * from the Lean Made Simple corpus (lib/lean-corpus.ts — the terminology
 * law), rotated by day and person so the card doesn't say the same thing
 * every morning.
 *
 * Pure: no database. services/daily-checkin.ts feeds it.
 */
import { LMS_CONCEPTS, LMS_EIGHT_WASTES } from "./lean-corpus";
import { londonDateString } from "./london-time";

/** The London calendar day a check-in belongs to ("YYYY-MM-DD"). */
export function checkinDay(now: Date = new Date()): string {
  return londonDateString(now);
}

/** Due unless they've already acknowledged today (London). */
export function isCheckinDue(acknowledgedDay: string | null | undefined, today: string): boolean {
  if (!acknowledgedDay) return true;
  return acknowledgedDay.slice(0, 10) !== today;
}

export const CHECKIN_CHOICES = ["got_it", "log_now"] as const;
export type CheckinChoice = (typeof CHECKIN_CHOICES)[number];

export interface CheckinPrompt {
  /** The waste's canonical name, e.g. "Motion". */
  waste: string;
  /** Our one-line definition. */
  definition: string;
  /** The kitchen example from the corpus. */
  example: string;
}

/** How many example prompts the card shows. */
export const PROMPTS_PER_DAY = 3;

/** A small stable hash so the rotation is the same all day for one person. */
function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Today's example prompts for one person: `n` different wastes, starting at
 * a point that moves with the day (and differs by person, so two people on
 * one iPad don't see the same three). Same answer all day.
 */
export function promptsForDay(
  userId: number,
  day: string,
  n: number = PROMPTS_PER_DAY,
  wastes: ReadonlyArray<{ name: string; definition: string; kitchenExample: string }> = LMS_EIGHT_WASTES,
): CheckinPrompt[] {
  if (wastes.length === 0) return [];
  const count = Math.min(n, wastes.length);
  const start = seedOf(`${day}:${userId}`) % wastes.length;
  // Step by a stride that is co-prime with the list length, so the three are
  // spread round the list rather than always neighbours.
  const stride = wastes.length % 3 === 0 ? 1 : 3;
  const out: CheckinPrompt[] = [];
  const used = new Set<number>();
  for (let i = 0; out.length < count && i < wastes.length * 2; i++) {
    const idx = (start + i * stride) % wastes.length;
    if (used.has(idx)) continue;
    used.add(idx);
    const w = wastes[idx];
    out.push({ waste: w.name, definition: w.definition, example: w.kitchenExample });
  }
  return out;
}

/** The corpus line under the nudge: "Leave it better than you found it". */
export function nudgeLine(): { term: string; nutshell: string } | null {
  return LMS_CONCEPTS.find(c => c.term === "Leave it better than you found it") ?? null;
}

/**
 * Their place on the Leaner-board, in the board's own order. Only said when
 * it's encouraging and true: they're on the board AND have credits in the
 * last 30 days (being "14th of 14" with nothing this month helps nobody —
 * the card says "your first one could be today" instead). The founder is
 * never on the board, so never placed.
 */
export function boardPlace(
  ranked: ReadonlyArray<{ userId: number | null; credits30: number }>,
  userId: number,
): { place: number; of: number } | null {
  const idx = ranked.findIndex(r => r.userId === userId);
  if (idx < 0 || !(ranked[idx].credits30 > 0)) return null;
  // Everyone level on credits shares the higher place — the board breaks
  // ties by score and all-time, but "joint 2nd" is the kinder truth.
  const credits = ranked[idx].credits30;
  const first = ranked.findIndex(r => r.credits30 === credits);
  // "of" = everyone with credits this month — the people actually in the race.
  return { place: first + 1, of: ranked.filter(r => r.credits30 > 0).length };
}

/**
 * "Ideas from the team" on the card (Graeme, 2026-10-26): "include a feed of
 * improvement ideas ... things that other people have decided ... to
 * generate a little bit of creativity, and give people things to think about
 * through the day."
 *
 * Other people's improvements from the last 30 days — done ones and ideas
 * still waiting — never their own. Ones with a photo go first (a picture
 * sells an idea from across the kitchen), then a daily shuffle per person,
 * so each morning shows different ones and two people on one iPad don't get
 * the same set. Same set all day.
 */
export const TEAM_IDEAS_PER_DAY = 6;

export interface TeamIdeaRow {
  id: number;
  title: string;
  station: string;
  byName: string | null;
  byUserIds: number[];
  done: boolean;
  /** An "after" photo if there is one, else any photo. */
  photoId: number | null;
  at: string;
}

export interface TeamIdea {
  id: number;
  title: string;
  station: string;
  by: string | null;
  done: boolean;
  photoId: number | null;
}

export function teamIdeasForDay(rows: readonly TeamIdeaRow[], userId: number, day: string, n: number = TEAM_IDEAS_PER_DAY): TeamIdea[] {
  return rows
    .filter(r => !r.byUserIds.includes(userId))
    .map(r => ({ r, k: seedOf(`${day}:${userId}:${r.id}`) }))
    .sort((a, b) => Number(b.r.photoId != null) - Number(a.r.photoId != null) || a.k - b.k)
    .slice(0, n)
    .map(({ r }) => ({ id: r.id, title: r.title, station: r.station, by: r.byName, done: r.done, photoId: r.photoId }));
}
