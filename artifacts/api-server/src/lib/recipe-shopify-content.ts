/**
 * A recipe's ingredient deck and nutrition, as a Shopify product gets them —
 * shared by the test-box product creator and "Create Shopify product" on a
 * recipe, so both write exactly what the recipe page shows.
 *
 * Read from the app's own endpoints over loopback (same pattern as
 * push-ingredient-deck and the spec sheet), carrying the caller's cookie.
 */
import type { Request } from "express";
import type { ContentLoader, LoadedContent } from "./test-box-shopify-run";

export function recipeContentLoader(req: Request): ContentLoader {
  const port = process.env["PORT"];
  const cookie = req.headers.cookie ?? "";
  const get = async <T>(path: string): Promise<T | null> => {
    if (!port) return null;
    try {
      const r = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { cookie } });
      return r.ok ? ((await r.json()) as T) : null;
    } catch { return null; }
  };
  return async (recipeId: number): Promise<LoadedContent> => {
    const [deck, nutri] = await Promise.all([
      get<{
        deckText: string; mayContainStatement: string | null; isComplete: boolean; missingDeclarations?: string[]; unwrappedDeclarations?: string[];
        missingDeclarationDetail?: Array<{ ingredientId: number; name: string }>;
      }>(`/api/recipes/${recipeId}/ingredient-deck`),
      get<{
        per100g: Record<string, number | null>; perPortion: Record<string, number | null> | null; portionWeightG: number | null;
        completeness: { missingNutritionals: string[]; missingNutritionalDetail?: Array<{ ingredientId: number; name: string; missing: string[] }> };
      }>(`/api/recipes/${recipeId}/nutritionals`),
    ]);
    const declIds = new Map((deck?.missingDeclarationDetail ?? []).map(d => [d.name, d.ingredientId]));
    return {
      deck: deck ? {
        deckText: deck.deckText ?? "", mayContainStatement: deck.mayContainStatement ?? null, isComplete: deck.isComplete === true,
        missing: [...(deck.missingDeclarations ?? []), ...(deck.unwrappedDeclarations ?? [])],
        missingDetail: (deck.missingDeclarations ?? []).map(name => ({ ingredientId: declIds.get(name) ?? null, name })),
        unwrapped: deck.unwrappedDeclarations ?? [],
      } : null,
      nutrition: nutri ? {
        per100g: nutri.per100g, perPortion: nutri.perPortion, portionWeightG: nutri.portionWeightG,
        complete: (nutri.completeness?.missingNutritionals?.length ?? 0) === 0,
        missing: nutri.completeness?.missingNutritionals ?? [],
        missingDetail: nutri.completeness?.missingNutritionalDetail ?? [],
      } : null,
    };
  };
}
