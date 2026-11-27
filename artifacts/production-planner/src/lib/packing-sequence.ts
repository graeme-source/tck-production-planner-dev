/**
 * The order of the packing morning (Graeme, 13 Nov 2026): 1 book the APC
 * labels (tagging every order waiting for approval first), 2 print the
 * dessert labels, 3 pack. Worked out from what's true now, so a later
 * despatch with new orders goes round again. A step with nothing to do is
 * done — no desserts on the orders means straight to packing. Pure.
 */
export type PackingStep = "book" | "desserts" | "ready";

export function packingStep(i: {
  /** Orders still to tag (left out deliberately ones excluded). */
  toTag: number;
  /** Tagged courier orders with no APC label yet (same). */
  toBook: number;
  /** Orders ready to pack now — labelled (or needing no label). Once any
   *  are, orders still waiting for a label (a booking issue, say) don't
   *  hold up the rest: the dessert labels print for the ready ones and
   *  packing starts, with the booking banner still up for the others
   *  (Graeme, 27 Nov 2026). Omitted = 0, the old rule. */
  ready?: number;
  /** Dessert labels still needed for the ready orders; null while it's being worked out. */
  dessertLabelsLeft: number | null;
}): PackingStep {
  if (i.toTag + i.toBook > 0 && !(i.ready && i.ready > 0)) return "book";
  if (i.dessertLabelsLeft == null || i.dessertLabelsLeft > 0) return "desserts";
  return "ready";
}

/** What stops a packing session starting, in words; null = go. */
export function packingBlocker(step: PackingStep, dessertsLoading: boolean): string | null {
  if (step === "book") return "First, book the APC labels.";
  if (step === "desserts") return dessertsLoading ? "Checking the dessert labels…" : "Print the dessert labels first.";
  return null;
}
