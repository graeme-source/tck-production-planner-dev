/**
 * Dates on a return-to-work form (pure, tested). A manager can record an
 * absence Planday doesn't show (Graeme, 2026-09-25), so the server checks
 * what it's given: a real date, the end not before the start, and nothing
 * in the future — a return-to-work form is about an absence that happened.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(iso: string): boolean {
  if (!ISO.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** null when fine, otherwise a sentence to show the person. */
export function checkAbsenceDates(start: string, end: string | null | undefined, todayIso: string): string | null {
  if (!isRealDate(start)) return "The first day off isn't a real date.";
  if (end != null && end !== "" && !isRealDate(end)) return "The last day off isn't a real date.";
  if (start > todayIso) return "The first day off can't be in the future.";
  if (end && end > todayIso) return "The last day off can't be in the future.";
  if (end && end < start) return "The last day off can't be before the first.";
  return null;
}
