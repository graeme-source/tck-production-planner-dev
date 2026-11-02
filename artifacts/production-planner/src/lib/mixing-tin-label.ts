/**
 * Mixing station — the words on the open filling panel and its button.
 *
 * Fix queue #373 (Major, mixing station): once every tin for a recipe was
 * done ("2 / 2 tins") the panel still said "Tin 3 of 2" and offered
 * "Complete Tin 3", which recorded nothing. When every tin is done the panel
 * now says so and the button gives way to a plain done message.
 * Pure — tested in mixing-tin-label.test.ts.
 */

export type MixingTinLabel = {
  /** True when every tin for the recipe is mixed. */
  allDone: boolean;
  /** Panel heading: "Filling Mix — Tin 2 of 3" or "All 3 tins mixed". */
  heading: string;
  /** Button text for the next tin, or null when there is no next tin. */
  completeLabel: string | null;
};

export function mixingTinLabel(tinsComplete: number, tinsTarget: number): MixingTinLabel {
  const allDone = tinsTarget > 0 && tinsComplete >= tinsTarget;
  if (allDone) {
    return {
      allDone,
      heading: `All ${tinsTarget} tin${tinsTarget === 1 ? "" : "s"} mixed`,
      completeLabel: null,
    };
  }
  const next = Math.max(tinsComplete, 0) + 1;
  return {
    allDone,
    heading: `Filling Mix — Tin ${next} of ${tinsTarget}`,
    completeLabel: `Complete Tin ${next}`,
  };
}
