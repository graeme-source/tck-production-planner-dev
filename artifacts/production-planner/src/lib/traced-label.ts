/**
 * The label photo as a step of prep (Graeme, 19 Nov 2026: "I don't want this
 * to be an option that someone has to remember to do… build it into the
 * flow of prep"). When someone with "Photograph opened packs" opens a traced
 * ingredient on a prep screen, the first thing it asks is a photo of the
 * pack's label — or "same batch as …" — and the tins wait until it's done.
 * Once a day per ingredient: a batch stays in use until the next pack is
 * opened on a later day (routes/traceability.ts). Pure, unit-tested.
 */

/** The day in the factory's time, YYYY-MM-DD. */
export function londonDay(d: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(typeof d === "string" ? new Date(d) : d);
}

export interface TracedLabelItem {
  id: number;
  current: { openedAt: string } | null;
}

/** Does this ingredient still need today's label? Untraced ones never do. */
export function labelNeededToday(item: TracedLabelItem | undefined, now: Date = new Date()): boolean {
  if (!item) return false;
  if (!item.current) return true;
  return londonDay(item.current.openedAt) !== londonDay(now);
}

/** Ticking a tin on (not off) waits for the label. */
export function tickWaitsForLabel(opts: { canPhotograph: boolean; needed: boolean; tickingOn: boolean }): boolean {
  return opts.canPhotograph && opts.needed && opts.tickingOn;
}
