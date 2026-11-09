// Weekly focus (Graeme, 5 Nov 2026): once a week is pinned, the weeks after it
// carry on through the curriculum from there, in the order the plan shows,
// rather than jumping back to wherever the calendar says. Pure and unit-tested.

export interface PlanWeek {
  id: number;
  status: string;
  /** Lessons written for this week. */
  lessonCount: number;
}

/** A draft with lessons counts, so a subject he's started by pinning its first
 *  week carries on into its other weeks. An empty week would leave the meeting
 *  with nothing to teach, so it's stepped over. */
const canFollowOn = (week: PlanWeek) => week.status === "locked" || week.lessonCount > 0;

/**
 * The week `weeksAfter` weeks on from the pinned one, wrapping round the plan.
 * `plan` is in teaching order. Null when the pinned week isn't in the plan, such
 * as an on-demand lesson: the calendar decides then.
 */
export function followOnWeek<W extends PlanWeek>(plan: W[], pinnedId: number, weeksAfter: number): W | null {
  const teachable = plan.filter(w => w.id === pinnedId || canFollowOn(w));
  const from = teachable.findIndex(w => w.id === pinnedId);
  if (from < 0) return null;
  return teachable[(from + weeksAfter) % teachable.length];
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
