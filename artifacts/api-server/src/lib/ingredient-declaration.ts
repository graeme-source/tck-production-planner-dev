/**
 * The label declaration as an ingredient save stores it — used by BOTH
 * ingredient save paths (POST /api/ingredients and PUT /api/ingredients/:id)
 * so a bare component list can never be stored again: it is wrapped under
 * the ingredient's own name ("Salted Butter (Butter (MILK), Salt)").
 * The rule itself is wrapDeclaration() in @workspace/allergens. Pure.
 */
import { wrapDeclaration } from "@workspace/allergens";

export interface DeclarationToStore {
  /** undefined = the body didn't send a declaration: leave the stored one. */
  value: string | null | undefined;
  /** True when the save wrapped a bare list — the response says so and the
   *  dialog shows "Wrapped under its name for the label". */
  wrapped: boolean;
}

export function declarationToStore(ingredientName: string | null | undefined, incoming: string | null | undefined): DeclarationToStore {
  if (incoming === undefined) return { value: undefined, wrapped: false };
  const w = wrapDeclaration(ingredientName ?? "", incoming);
  // No usable name to wrap under — store as typed rather than "(…)".
  if (w.wrapped && !(ingredientName ?? "").trim()) return { value: (incoming ?? "").trim() || null, wrapped: false };
  return { value: w.declaration, wrapped: w.wrapped };
}
