/**
 * One "Graeme edited the task" line per sitting on a to-do's timeline.
 *
 * The docked panel's edit page saves as you type (25 Nov 2026), so one edit
 * arrives as several saves. The timeline says it once: a further save by the
 * same person adds nothing while their own edit is still the last thing on
 * the timeline and is recent. Anything in between — a comment, a tick, someone
 * else's edit — and the next edit is worth saying again. Objective G.
 */
export const EDIT_SITTING_MINUTES = 15;

export interface LastTimelineRow {
  kind: string;
  user_id: number | null;
  body: string;
  /** Within EDIT_SITTING_MINUTES of now, by the database's clock. */
  recent: boolean;
}

export function editAlreadyLogged(last: LastTimelineRow | null | undefined, editorId: number, body: string): boolean {
  return !!last && last.recent && last.kind === "event" && last.user_id === editorId && last.body === body;
}
