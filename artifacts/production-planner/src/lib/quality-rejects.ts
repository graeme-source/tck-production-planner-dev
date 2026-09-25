/**
 * Quality rejects on screen — the two classifications, side by side
 * (Graeme, 2026-09-25: "They're both quality rejects, but some of them are
 * going to be dog bins, and some of them are wonkies.").
 *
 *   Wonky   — sellable as Wonky stock. Waits on the Wonky Rack until the
 *             wrapping team transfers it to the Product Freezer.
 *   Dog bin — thrown away. Never stock anywhere.
 *
 * Both come off what reaches the fridge (netTwoPacks in
 * pages/station/shared/recipe-completion.ts). The server rules live in
 * api-server lib/quality-rejects.ts; this file is the screen side: the
 * words, the "is there anything left to reject?" guard, and the one way the
 * pair is written out in a sentence. Pure — tested without a browser.
 */

export type QualityRejectKind = "wonky" | "dog_bin";

export const QUALITY_REJECT_COPY: Record<QualityRejectKind, {
  /** The button label. */
  label: string;
  /** What happens to it, under the label. */
  fate: string;
  /** The API path segment on /production-plans/:id/items/:itemId/… */
  path: string;
  /** Toast title after a + tap. */
  recorded: string;
}> = {
  wonky: { label: "Wonky", fate: "Sold as wonky", path: "wonly", recorded: "Wonky recorded" },
  dog_bin: { label: "Dog bin", fate: "Thrown away", path: "dog-bin", recorded: "Dog bin recorded" },
};

/** "6 wonky · 2 dog bin" — dog bins always shown, even at 0, so the two
 *  figures are never mistaken for one. */
export function formatQualityRejects(wonky: number, dogBin: number): string {
  return `${wonky} wonky · ${dogBin} dog bin`;
}

export interface RejectRoomInput {
  /** Packs that came out of the ovens for the item. */
  grossPacks: number;
  fridgeQty: number;
  freezerQty: number;
  /** Wonkies still on the rack (a transferred wonky is in freezerQty). */
  wonlyCount: number;
  dogBinCount: number;
}

/** Packs out of the ovens not yet accounted for anywhere — the most that can
 *  still be classed as a reject. A pack can't be wrapped into the fridge AND
 *  thrown in the dog bin. */
export function packsLeftToClassify(i: RejectRoomInput): number {
  return Math.max(0, i.grossPacks - i.fridgeQty - i.freezerQty - i.wonlyCount - i.dogBinCount);
}
