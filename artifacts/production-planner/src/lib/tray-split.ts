/**
 * One tray's share of an amount on the Raw Meat screen — the meat's
 * marinades and its held-back "add at cooking" items alike (Graeme, 24 Nov
 * 2026: wine and beef stock showed only the whole amount, but "we have to
 * weigh it out separately"). Null when the meat isn't split into trays.
 */
export function perTrayGrams(totalGrams: number, trays: number | null | undefined, split: boolean): number | null {
  return split && trays != null && trays > 0 ? Math.round(totalGrams / trays) : null;
}
