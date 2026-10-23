/**
 * Why an ingredient can't be deleted, in words the team can act on (#326).
 *
 * Jane tried to delete a duplicate Mixed Herbs and got a raw red error: the
 * route only looked one level into the error for Postgres's "still in use"
 * code (23503), and drizzle can wrap it deeper, so the friendly 409 never
 * showed. pgErrorCode walks the whole cause chain.
 */

/** The Postgres error code anywhere in an error's cause chain, or null. */
export function pgErrorCode(err: unknown): string | null {
  let cur: unknown = err;
  for (let depth = 0; depth < 10 && cur && typeof cur === "object"; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

export const FOREIGN_KEY_VIOLATION = "23503";

export interface IngredientUsage {
  recipeNames: string[];
  subRecipeNames: string[];
  purchaseOrderLines: number;
  stockRecords: number;
  prepRecords: number;
  kanbanItems: number;
}

const list = (names: string[]) =>
  `${names.slice(0, 5).join(", ")}${names.length > 5 ? ` (+${names.length - 5} more)` : ""}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function ingredientInUseMessage(name: string, u: IngredientUsage): string {
  const parts: string[] = [];
  if (u.recipeNames.length) parts.push(`recipes: ${list(u.recipeNames)}`);
  if (u.subRecipeNames.length) parts.push(`sub-recipes: ${list(u.subRecipeNames)}`);
  if (u.purchaseOrderLines > 0) parts.push(plural(u.purchaseOrderLines, "purchase-order line"));
  if (u.stockRecords > 0) parts.push(plural(u.stockRecords, "stock record"));
  if (u.prepRecords > 0) parts.push(plural(u.prepRecords, "prep record"));
  if (u.kanbanItems > 0) parts.push(plural(u.kanbanItems, "kanban item"));
  const usage = parts.length ? parts.join(" · ") : "other records";
  const inRecipes = u.recipeNames.length > 0 || u.subRecipeNames.length > 0;
  const hasHistory = u.purchaseOrderLines > 0 || u.stockRecords > 0 || u.prepRecords > 0 || u.kanbanItems > 0;
  return `Can't delete "${name}" — it is still in use by ${usage}.` +
    (inRecipes ? " Remove it from those recipes first." : "") +
    (hasHistory
      ? " Order and stock history can't be moved by deleting. If it's a duplicate of another ingredient, ask a manager to merge it into the other one."
      : "");
}
