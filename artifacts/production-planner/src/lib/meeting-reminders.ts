/**
 * Standing morning-meeting reminders — the client-side rules (Graeme,
 * 23 Oct 2026, objective E). The reminders themselves live on the server
 * (migration 0250, /api/meeting-reminders); which ones show on a day is
 * decided there (api-server lib/meeting-reminders.ts).
 *
 * Here: where the Reminders slide sits in every meeting, and turning an old
 * per-day "Reminders" note into separate standing reminders.
 */

/** Slide kind of the built-in Reminders slide. It isn't stored in the
 *  template or the day's slide list — every meeting gets it automatically,
 *  the way the Safety slide always shows the open safety issues. */
export const STANDING_REMINDERS_KIND = "standing_reminders";
/** Synthetic id — real slide ids are positive serials. */
export const STANDING_REMINDERS_SLIDE_ID = -1;

interface SlideLike { id: number; kind: string; title: string; orderPosition: number }

/**
 * The day's slides with the Reminders slide added. It goes straight after
 * the Safety slide (house business first), else just before Gratitude (the
 * closer), else at the end. Always present — even with no reminders — so the
 * slide count never changes mid-meeting when the last one is removed, and the
 * room can add one on the spot. If the day's list already has one (a future
 * template could carry it) nothing is added.
 */
export function withStandingRemindersSlide<T extends SlideLike>(slides: readonly T[], make: (s: SlideLike) => T): T[] {
  if (slides.length === 0) return [];
  if (slides.some(s => s.kind === STANDING_REMINDERS_KIND)) return [...slides];
  const slide = make({ id: STANDING_REMINDERS_SLIDE_ID, kind: STANDING_REMINDERS_KIND, title: "Reminders", orderPosition: 0 });
  const safety = slides.findIndex(s => s.kind === "safety_issues");
  const gratitude = slides.findIndex(s => s.kind === "gratitude");
  const at = safety >= 0 ? safety + 1 : gratitude >= 0 ? gratitude : slides.length;
  return [...slides.slice(0, at), slide, ...slides.slice(at)];
}

/** Split an old per-day note ("- Fire alarm at 11\n- Aprons on") into one
 *  reminder per line, dropping list markers and blank lines. */
export function reminderLinesFromNote(md: string | null | undefined): string[] {
  if (!md) return [];
  return md
    .split(/\r?\n/)
    .map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])(?:\s+|$)/, "").replace(/\*\*/g, "").trim())
    .filter(l => l.length > 0)
    .map(l => l.slice(0, 500));
}
