// The founder's review-ahead to-do (Graeme, 5 Nov 2026): it always names next
// week's actual lesson, and asks for the lessons to be written when a pinned
// week has none yet, because there's nothing to review. Pure and unit-tested.

export function leanWeekLabel(week: { title: string; partLabel?: string | null; partIndex?: number | null }): string {
  if (week.partLabel) return `${week.title} — ${week.partLabel}`;
  return week.partIndex === 1 ? `${week.title} — overview` : week.title;
}

export function founderReviewTodo(week: { title: string; partLabel?: string | null; partIndex?: number | null }, lessonCount: number): { title: string; url: string } {
  const label = leanWeekLabel(week);
  return lessonCount > 0
    ? { title: `Review next week's lean module: ${label}`, url: "/lean-review?week=next" }
    : { title: `Write next week's lean lessons: ${label}`, url: "/lean-curriculum" };
}
