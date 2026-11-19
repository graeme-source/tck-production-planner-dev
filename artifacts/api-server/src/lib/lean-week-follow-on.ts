// Weekly focus (Graeme, 5 Nov 2026): once a week is pinned, the weeks after it
// carry on through the curriculum from there, in the order the plan shows,
// rather than jumping back to wherever the calendar says. Pure and unit-tested.

export interface PlanWeek {
  id: number;
  status: string;
  /** Lessons written for this week. */
  lessonCount: number;
}

/** Only a week that's READY (locked) and written is taught — the Lean
 *  curriculum page's rule, everywhere (Graeme, 19 Nov 2026: weeks he thought
 *  were going out were drafts). A draft or an empty week is stepped over. */
const canFollowOn = (week: PlanWeek) => week.status === "locked" && week.lessonCount > 0;

/**
 * The week `weeksAfter` weeks on from the pinned one, wrapping round the plan.
 * `plan` is in teaching order. Null when the pinned week isn't in the plan, such
 * as an on-demand lesson: the calendar decides then.
 */
export function followOnWeek<W extends PlanWeek>(plan: W[], pinnedId: number, weeksAfter: number): W | null {
  return followOnDetail(plan, pinnedId, weeksAfter)?.week ?? null;
}

/** followOnWeek, saying whether it only got there by running off the end of
 *  the plan and starting again from the top — the cue to add a new subject. */
export function followOnDetail<W extends PlanWeek>(plan: W[], pinnedId: number, weeksAfter: number): { week: W; wrapped: boolean } | null {
  const teachable = plan.filter(w => w.id === pinnedId || canFollowOn(w));
  const from = teachable.findIndex(w => w.id === pinnedId);
  if (from < 0) return null;
  return { week: teachable[(from + weeksAfter) % teachable.length], wrapped: from + weeksAfter >= teachable.length };
}

/**
 * The backlog subject to suggest when the plan is about to run out (Graeme,
 * 19 Nov 2026: "put something in, like Total Ownership"): the next TEAM
 * subject, in the backlog's order, after the furthest one already in the plan.
 * A subject counts as planned by its link or, for the older weeks that have
 * none, by its title appearing in a planned week's title.
 */
export function suggestNextSubject<S extends { id: number; title: string; audience: string; sortOrder: number; isArchived: boolean }>(
  subjects: S[],
  plan: Array<{ subjectId: number | null; title: string }>,
): S | null {
  const team = subjects.filter(s => s.audience === "team" && !s.isArchived).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const planned = (s: S) => plan.some(w => w.subjectId === s.id || w.title.toLowerCase().includes(s.title.toLowerCase()));
  const furthest = team.reduce((max, s) => (planned(s) ? Math.max(max, s.sortOrder) : max), -Infinity);
  return team.find(s => s.sortOrder > furthest && !planned(s)) ?? team.find(s => !planned(s)) ?? null;
}

/**
 * The week the plan says comes next, written or not (Graeme, 9 Nov 2026). The
 * team's meeting steps over an empty week (followOnWeek), but the founder's
 * to-do must name it, so he's asked to write 3S — Sweep rather than told to
 * review Seeing Waste, which the plan only reached by wrapping round.
 */
export function plannedWeek<W extends PlanWeek>(plan: W[], pinnedId: number, weeksAfter: number): W | null {
  const from = plan.findIndex(w => w.id === pinnedId);
  if (from < 0) return null;
  return plan[(from + weeksAfter) % plan.length];
}

/** How far ahead the plan should always be ready (Graeme, 19 Nov 2026: "keep
 *  a couple of weeks ahead at all times"). */
export const LEAN_WEEKS_AHEAD = 2;

/** The first coming week that only has a lesson because the plan ran out and
 *  started again from the top — within this week and the next `weeksAhead`
 *  — or null. `schedule` runs from this Monday, a week per entry. */
export function planRunsOut(schedule: Array<{ weekStart: string; wrapped: boolean }>, weeksAhead = LEAN_WEEKS_AHEAD): string | null {
  return schedule.slice(0, weeksAhead + 1).find(w => w.wrapped)?.weekStart ?? null;
}

/** Mondays from `thisMonday`, `count` of them (YYYY-MM-DD). */
export function mondaysFrom(thisMonday: string, count: number): string[] {
  const start = Date.parse(`${thisMonday}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(start + i * 7 * 86_400_000).toISOString().slice(0, 10));
}
