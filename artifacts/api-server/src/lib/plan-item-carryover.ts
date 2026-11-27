/**
 * Saving a plan's recipe list replaces its rows (PUT /production-plans/:id
 * deletes and re-inserts them from what the Create / Edit screen sends). The
 * screen doesn't send figures that other parts of the app put on a row —
 * 8-pack bags from Process and the queued 8-pack orders, case-order freezer
 * bags, the case order link, a mixing tin override — so they used to go
 * back to 0 (Graeme, 27 Nov 2026: a queued Carnizone bag went onto Tue 1
 * Dec's plan at the first auto-save and was wiped by Activate & Lock).
 *
 * Each new row takes those figures from the old row for the same recipe
 * (the first unused one, in order, when a recipe appears twice). A recipe
 * that's new to the plan starts at the defaults; a recipe removed from the
 * plan drops its figures with it. Pure — tested.
 */
export interface CarriedFields {
  eightPackBagCount: number;
  freezerEightPackBagCount: number;
  caseOrderId: number | null;
  mixingTinOverride: number | null;
}

export function carryOverItemFields(
  oldRows: ReadonlyArray<{ recipeId: number } & Partial<CarriedFields>>,
  newRecipeIds: readonly number[],
): Array<Partial<CarriedFields>> {
  const pool = oldRows.map(r => ({ ...r, used: false }));
  return newRecipeIds.map(recipeId => {
    const old = pool.find(r => !r.used && r.recipeId === recipeId);
    if (!old) return {};
    old.used = true;
    const out: Partial<CarriedFields> = {};
    if (old.eightPackBagCount) out.eightPackBagCount = old.eightPackBagCount;
    if (old.freezerEightPackBagCount) out.freezerEightPackBagCount = old.freezerEightPackBagCount;
    if (old.caseOrderId != null) out.caseOrderId = old.caseOrderId;
    if (old.mixingTinOverride != null) out.mixingTinOverride = old.mixingTinOverride;
    return out;
  });
}
