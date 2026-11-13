/**
 * Next-label preload (Graeme, 13 Nov 2026: "start loading the PDF so that,
 * if we do indeed go and open the next order, it can print faster").
 *
 * While an order is packed, the packing screen finds the NEXT order's booked
 * consignment (look-up only — never books) and loads its label into a hidden
 * print frame, WITHOUT telling APC it's printed. Opening that order then
 * prints the loaded label at once and tells APC "printed" at that moment, so
 * a skipped or held order never reaches the manifest.
 *
 * A label is only ever correct at the instant it's fetched (Graeme amends
 * consignments in Hypaship), so a prepared one is only used while it's
 * younger than LABEL_PRELOAD_MAX_AGE_MS; the screen refreshes it before then
 * and gives up refreshing after LABEL_PRELOAD_GIVE_UP_MS of nobody opening
 * it. Older → fetched fresh at open, exactly as before. Pure.
 */

export const LABEL_PRELOAD_MAX_AGE_MS = 2 * 60_000;
/** Refresh a little before it expires, so a slow order still prints at once. */
export const LABEL_PRELOAD_REFRESH_MS = LABEL_PRELOAD_MAX_AGE_MS - 20_000;
/** Stop re-fetching for a bench that has gone quiet (break, end of wave). */
export const LABEL_PRELOAD_GIVE_UP_MS = 10 * 60_000;

export interface PreloadedLabel {
  orderId: number;
  waybill: string;
  url: string;
  state: "loading" | "ready" | "failed";
  /** When the PDF finished loading (ms since epoch); 0 while loading. */
  loadedAt: number;
  /** When this order was first prepared — the give-up clock. */
  firstPreparedAt: number;
}

/** Can the prepared label be printed for this order and consignment now? */
export function usablePreload(p: PreloadedLabel | null, orderId: number, waybill: string, now: number): boolean {
  return !!p
    && p.orderId === orderId
    && p.waybill === waybill
    && p.state === "ready"
    && p.loadedAt > 0
    && now - p.loadedAt < LABEL_PRELOAD_MAX_AGE_MS;
}

/** Keep refreshing it, or has the bench gone quiet? */
export function shouldRefreshPreload(p: PreloadedLabel, now: number): boolean {
  return now - p.firstPreparedAt < LABEL_PRELOAD_GIVE_UP_MS;
}

/** The order Complete will open next: the first one left in the wave that
 *  isn't the current one or skipped — the same rule as advanceToNext. */
export function nextOrderToPrepare<T extends { id: number }>(wave: readonly T[], currentId: number, skipped: ReadonlySet<number>): T | null {
  return wave.find(o => o.id !== currentId && !skipped.has(o.id)) ?? null;
}

/** The label as a print frame loads it ahead: print guards apply on the
 *  server, but APC isn't told it's printed (no print=1). */
export function labelPreloadUrl(base: string, waybill: string): string {
  return `${base}/api/fulfilment/shipments/${encodeURIComponent(waybill)}/label.pdf?piece=1&preload=1&t=${Date.now()}`;
}
