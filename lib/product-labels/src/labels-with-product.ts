/**
 * "Create Shopify product" also sets up the recipe's labels (Graeme, 30 Oct
 * 2026: "We also need to automatically generate a back label print for it at
 * the same time" … "Can we also include … front label generation as well?").
 * Objectives A and D. The pure decisions — what the Create window ticks to
 * start with, and why a label can't be set up — shared by the browser (the
 * ticks) and the server (the result wording). The work itself always goes
 * through the label page's own server paths: publishing the back label
 * (product-label-publish.ts — the "Update live version" path, with the
 * Create confirmation as the human tick) and switching the front label on
 * (product-front-label.ts PUT /:recipeId/default).
 */

export interface LabelSetupPlan {
  /** It can be set up from the Create window. */
  canSetUp: boolean;
  /** Ticked to start with. */
  ticked: boolean;
  /** Plain words for the window: what happens, or why not. */
  reason: string;
}

/** The back label (the recipe's MAIN label — template picked the label
 *  page's way). `blockers` are the label page's own publish blockers
 *  (labelPublishBlockers: archived, doesn't fit, content problems, deck
 *  declarations) — a label it would refuse is never published from here. */
export function backLabelPlan(input: {
  hasLive: boolean;
  liveVersionNo?: number | null;
  /** The label as it is now is the live one. */
  matchesLive: boolean;
  fits: boolean;
  blockers: readonly string[];
}): LabelSetupPlan {
  const blockers = input.blockers.length ? [...input.blockers] : input.fits ? [] : ["The label doesn't fit."];
  if (blockers.length) {
    return { canSetUp: false, ticked: false, reason: `Not published — ${blockers.join(" ")} Fix it on the recipe's label page, then press "Update live version" there.` };
  }
  if (input.hasLive && input.matchesLive) {
    return { canSetUp: false, ticked: false, reason: "The live back label is already this version — nothing to publish. The wrapping station can print it." };
  }
  if (input.hasLive) {
    return {
      canSetUp: true, ticked: false,
      reason: `A live back label already exists${input.liveVersionNo ? ` (version ${input.liveVersionNo})` : ""} and the recipe has changed since. Ticking this updates the live version — exactly like "Update live version" on the label page.`,
    };
  }
  return { canSetUp: true, ticked: true, reason: "No live back label yet — this one is published, so the wrapping station can print it." };
}

/** The front name label (102 × 25 mm, the recipe's label name or name).
 *  "Set up" = switched on as the product's front label (migration 0269), so
 *  the wrapping station makes "Print front labels" its main button. The
 *  label page only refuses one with no name to print (canPrint false). */
export function frontLabelPlan(input: { isDefault: boolean; canPrint: boolean }): LabelSetupPlan {
  if (!input.canPrint) {
    return { canSetUp: false, ticked: false, reason: "Not set up — this recipe has no name to print. Give it a name (or a label name on the recipe's label page) first." };
  }
  if (input.isDefault) {
    return { canSetUp: false, ticked: false, reason: "Already set up as the product's front label — the wrapping station shows Print front labels." };
  }
  return { canSetUp: true, ticked: true, reason: "Switched on as the product's front label, so the wrapping station shows Print front labels as its main button." };
}
