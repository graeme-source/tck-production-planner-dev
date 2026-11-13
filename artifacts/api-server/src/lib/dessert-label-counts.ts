/**
 * How many dessert labels print (Objective C).
 *
 * Graeme, 13 Nov 2026: the desserts report should always ask only for what's
 * still needed — "once we've printed in the morning … if we receive more
 * orders, count what is still to be printed" — and say when everything has
 * been printed. So the one-tap default is the day's orders MINUS the labels
 * already printed for that dispatch day (dessert_label_prints).
 *
 * "Print some" stays as an ad-hoc choice (fix-queue #374), and since 13 Nov
 * it is no longer capped at the orders: "I could just choose to print
 * brownie labels if the calculation gets this wrong." Whatever prints is
 * recorded, so it counts towards the day.
 */

/** The most labels one request may print. */
export const MAX_AD_HOC_LABELS = 200;

/** Labels still needed for one line: ordered − printed, never below zero. */
export function labelsLeft(ordered: number, printed: number): number {
  const o = Number.isFinite(ordered) ? Math.floor(ordered) : 0;
  const p = Number.isFinite(printed) ? Math.floor(printed) : 0;
  return Math.max(0, o - p);
}

/** What a request prints for one line: the chosen count (whole, 0–200,
 *  not limited by the orders), or with no choice, what's still needed. */
export function labelCountToPrint(ordered: number, printed: number, requested?: number | null): number {
  if (requested === undefined || requested === null) return labelsLeft(ordered, printed);
  if (!Number.isFinite(requested)) return 0;
  return Math.min(MAX_AD_HOC_LABELS, Math.max(0, Math.floor(requested)));
}

/** The key a 5-pack flavour is chosen and recorded by: its variant, else its name. */
export function fivePackLineKey(line: { variantId: string | null; productTitle: string }): string {
  return line.variantId ?? line.productTitle;
}

/** Each 5-pack flavour with how many labels to print. No `requested` =
 *  each flavour's labels still needed (orders − printed). With `requested`,
 *  a flavour not in it prints none. Flavours that come to zero are left out. */
export function fivePackLabelCopies<L extends { variantId: string | null; productTitle: string; quantity: number }>(
  lines: L[],
  requested?: Record<string, number> | null,
  printed: Record<string, number> = {},
): Array<L & { copies: number }> {
  return lines
    .map(l => {
      const key = fivePackLineKey(l);
      return { ...l, copies: requested ? labelCountToPrint(l.quantity, printed[key] ?? 0, requested[key] ?? 0) : labelsLeft(l.quantity, printed[key] ?? 0) };
    })
    .filter(l => l.copies > 0);
}
