/**
 * The Marketing Calendar's email panel (Graeme, 10 Nov 2026): this month's
 * Klaviyo email revenue as a share of store sales, and the last five emails
 * sent with their results. Objective I. Pure.
 */

/** Whole-number share, or null when there's nothing to divide by. */
export function sharePercent(part: number | null | undefined, whole: number | null | undefined): number | null {
  if (part == null || whole == null || !(whole > 0) || !Number.isFinite(part)) return null;
  return Math.round((part / whole) * 100);
}

/** The first of this month and today, as London days. */
export function monthToDateRange(now: Date = new Date()): { from: string; to: string } {
  const to = now.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  return { from: `${to.slice(0, 8)}01`, to };
}

/** n London days before `day` ("2026-11-10", 60 → "2026-09-11"). */
export function daysBefore(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

interface SentLike { status: string; sendAt: string | null }

/** The last n emails actually sent (Sending counts), newest first. */
export function lastSent<T extends SentLike>(emails: readonly T[], n = 5): T[] {
  return emails
    .filter((e) => (e.status === "Sent" || e.status === "Sending") && e.sendAt)
    .sort((a, b) => (b.sendAt! < a.sendAt! ? -1 : b.sendAt! > a.sendAt! ? 1 : 0))
    .slice(0, n);
}
