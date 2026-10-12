/**
 * Pure helpers behind the "fix it here" buttons on ingredient-declaration
 * checks (components/declaration-fix.tsx). Kept free of React so they're
 * tested on their own.
 */
import type { DeclarationIssue } from "@workspace/allergens";

/** Query keys whose answers depend on an ingredient's declaration — all
 *  invalidated after a fix so every check re-runs without a reload. */
export const DECLARATION_DEPENDENT_KEYS: ReadonlyArray<readonly unknown[]> = [
  ["product-labels"],
  ["recipe-ingredient-deck"],
  ["recipe-nutritionals"],
  ["sub-recipe-label-usage"],
];

export interface IssueGroup {
  kind: DeclarationIssue["kind"];
  title: string;
  help: string;
  items: DeclarationIssue[];
}

/** The issues grouped as the check shows them, with what to do about each. */
export function issueGroups(issues: DeclarationIssue[]): IssueGroup[] {
  const missing = issues.filter(i => i.kind === "missing");
  const unwrapped = issues.filter(i => i.kind === "unwrapped");
  const out: IssueGroup[] = [];
  if (missing.length) out.push({
    kind: "missing",
    title: `${missing.length === 1 ? "1 ingredient has" : `${missing.length} ingredients have`} no label declaration`,
    help: "Tap one to add it.",
    items: missing,
  });
  if (unwrapped.length) out.push({
    kind: "unwrapped",
    title: "Declaration needs its compound name around the list",
    help: "Tap one and press Save — it's wrapped under its name automatically.",
    items: unwrapped,
  });
  return out;
}

/** The blockers NOT about declarations — the declaration ones are shown as
 *  fix buttons instead of plain text. `deckBlockers` is the server's exact
 *  text for those lines. */
export function otherBlockers(blockers: string[], deckBlockers: string[] | undefined, issues: DeclarationIssue[] | undefined): string[] {
  if (!issues?.length || !deckBlockers?.length) return blockers;
  const deck = new Set(deckBlockers);
  return blockers.filter(b => !deck.has(b));
}

/** Declaration issues for a sub-recipe's own ingredient rows, from the
 *  ingredient list the page already has. */
export function rowsToDeclarationItems(
  rows: Array<{ ingredientId: number | string }>,
  ingredients: Array<{ id: number; name: string; labelDeclaration: string | null }>,
): Array<{ ingredientId: number; name: string; labelDeclaration: string | null }> {
  const out: Array<{ ingredientId: number; name: string; labelDeclaration: string | null }> = [];
  for (const r of rows) {
    const ing = ingredients.find(i => i.id === Number(r.ingredientId));
    if (ing) out.push({ ingredientId: ing.id, name: ing.name, labelDeclaration: ing.labelDeclaration });
  }
  return out;
}
