/**
 * How many dessert labels print when someone asks for fewer than the whole
 * day (fix-queue #374, Grant, 2026-10-29: a second packing run later in the
 * day only needs the extra labels). Objective F.
 *
 * The day's orders stay the ceiling: a chosen count can only ever be LESS
 * than or equal to what the orders call for, never more, so "Print some"
 * can't over-print by mistake. No count = the whole day, as before.
 */

/** Labels to print for one line: the day's total, or the chosen count
 *  capped at that total. Zero, negative or non-numbers print nothing. */
export function cappedLabelCount(total: number, requested?: number | null): number {
  const ceiling = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  if (requested === undefined || requested === null) return ceiling;
  if (!Number.isFinite(requested)) return 0;
  return Math.min(ceiling, Math.max(0, Math.floor(requested)));
}

/** The key a 5-pack flavour is chosen by: its variant, else its name. */
export function fivePackLineKey(line: { variantId: string | null; productTitle: string }): string {
  return line.variantId ?? line.productTitle;
}

/** Each 5-pack flavour with how many labels to print. No `requested` =
 *  every flavour × its day's quantity. With `requested`, a flavour not in
 *  it prints none, and each one is capped at its own day's quantity.
 *  Flavours that come to zero are left out. */
export function fivePackLabelCopies<L extends { variantId: string | null; productTitle: string; quantity: number }>(
  lines: L[],
  requested?: Record<string, number> | null,
): Array<L & { copies: number }> {
  return lines
    .map(l => ({
      ...l,
      copies: requested ? cappedLabelCount(l.quantity, requested[fivePackLineKey(l)] ?? 0) : cappedLabelCount(l.quantity),
    }))
    .filter(l => l.copies > 0);
}
