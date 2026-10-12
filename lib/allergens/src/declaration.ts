/**
 * Label-declaration shape rules — shared by the API server (save-time
 * auto-wrap, deck checks) and the app (live hints in the ingredient dialog)
 * so the two can never disagree. Pure, no I/O.
 *
 * A compound ingredient (one with its own ingredients — butter, chorizo,
 * a sauce) must be declared as "Name (component, component…)". A bare list
 * ("Butter (MILK), Salt") is concatenated into the product's deck as a
 * run-on that never says which ingredient those components belong to, so
 * the deck refuses it (2026-10-12: Salted Butter on Garlic Cheese).
 * Saving now wraps it under the ingredient's own name automatically.
 */

/** True when a declaration lists several components but never names the compound
 *  ingredient they belong to — e.g. "Pork, Salt, Paprika" instead of
 *  "Chorizo (Pork, Salt, Paprika)". A correctly wrapped declaration has no
 *  top-level comma before its first bracket, and that bracket closes at the very
 *  end, so the whole string is one "Name (...)" group. Single-component
 *  declarations ("Salt", "Basil") need no wrapper and are never flagged. */
export function declarationNeedsWrapper(declaration: string): boolean {
  const s = declaration.trim().replace(/\.+$/, "").trim();
  if (!s) return false;

  const firstBracket = s.indexOf("(");
  // Wrapped iff nothing before the first bracket contains a comma AND that
  // bracket's match is the final character.
  let wrapped = false;
  if (firstBracket !== -1 && !s.slice(0, firstBracket).includes(",")) {
    let depth = 0;
    for (let j = firstBracket; j < s.length; j++) {
      if (s[j] === "(") depth++;
      else if (s[j] === ")") {
        depth--;
        if (depth === 0) { wrapped = j === s.length - 1; break; }
      }
    }
  }
  if (wrapped) return false;

  // Not wrapped — only a problem if it's actually a multi-component list.
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) return true; // top-level comma => compound
  }
  return false;
}

/** The ingredient's name as it should read on a label. Our stock names carry
 *  bracketed notes for the kitchen — pack size, supplier, prep state:
 *  "Burger Sauce (2.1kg catering)", "Hoisin Sauce (Blue Dragon)",
 *  "Gherkin (drained weight)". Those come off the END of the name (any number
 *  of them); a bracket in the middle of a name is kept. Spacing is tidied.
 *  Nothing else is changed — spelling is left exactly as typed, because a
 *  "fix" we guessed wrong would print on the pack. */
export function labelNameFor(name: string): string {
  let s = name.replace(/\s+/g, " ").trim();
  for (;;) {
    const m = /^(.*\S)\s*\([^()]*\)$/.exec(s);
    if (!m) break;
    s = m[1].trim();
  }
  return s || name.trim();
}

/** A declaration's component list made tidy for putting inside brackets:
 *  surrounding spaces off, and trailing full stops / commas off (the deck
 *  adds its own single full stop at the very end of the whole list). */
function tidyList(declaration: string): string {
  return declaration.trim().replace(/[\s.,;]+$/, "").trim();
}

export interface WrappedDeclaration {
  /** What to store: null for an empty declaration. */
  declaration: string | null;
  /** True when the bare list was put under the ingredient's name. */
  wrapped: boolean;
}

/** The declaration to STORE for an ingredient. A bare multi-component list
 *  becomes "<label name> (<list>)"; anything else is stored as typed
 *  (trimmed). "Salted Butter" + " Butter (MILK), Salt." →
 *  "Salted Butter (Butter (MILK), Salt)". */
export function wrapDeclaration(ingredientName: string, declaration: string | null | undefined): WrappedDeclaration {
  const s = (declaration ?? "").trim();
  if (!s) return { declaration: null, wrapped: false };
  if (!declarationNeedsWrapper(s)) return { declaration: s, wrapped: false };
  return { declaration: `${labelNameFor(ingredientName)} (${tidyList(s)})`, wrapped: true };
}

/** One row of a bulk wrap: what it is now and what it would become. */
export interface DeclarationWrapChange {
  id: number;
  name: string;
  before: string;
  after: string;
}

/** Every unwrapped declaration in `rows` with the value it should be —
 *  the one-off tidy for existing data and future imports. Rows that are
 *  empty or already fine are left out. */
export function planDeclarationWraps(rows: Array<{ id: number; name: string; labelDeclaration: string | null }>): DeclarationWrapChange[] {
  const out: DeclarationWrapChange[] = [];
  for (const r of rows) {
    if (!r.labelDeclaration) continue;
    const w = wrapDeclaration(r.name, r.labelDeclaration);
    if (w.wrapped && w.declaration) out.push({ id: r.id, name: r.name, before: r.labelDeclaration, after: w.declaration });
  }
  return out;
}

/** A deck problem with a named ingredient that someone can fix in its
 *  edit dialog. "missing" = no declaration at all; "unwrapped" = a bare
 *  component list (only possible for data saved before auto-wrap). */
export interface DeclarationIssue {
  kind: "missing" | "unwrapped";
  ingredientId: number;
  name: string;
}

/** The fixable declaration problems among a deck's ingredients, each
 *  ingredient once, missing ones first, in the order met. */
export function declarationIssues(items: Array<{ ingredientId: number | null | undefined; name: string; labelDeclaration: string | null }>): DeclarationIssue[] {
  const missing = new Map<number, DeclarationIssue>();
  const unwrapped = new Map<number, DeclarationIssue>();
  for (const i of items) {
    if (i.ingredientId == null) continue;
    if (!i.labelDeclaration || !i.labelDeclaration.trim()) {
      if (!missing.has(i.ingredientId)) missing.set(i.ingredientId, { kind: "missing", ingredientId: i.ingredientId, name: i.name });
    } else if (declarationNeedsWrapper(i.labelDeclaration)) {
      if (!unwrapped.has(i.ingredientId)) unwrapped.set(i.ingredientId, { kind: "unwrapped", ingredientId: i.ingredientId, name: i.name });
    }
  }
  return [...missing.values(), ...unwrapped.values()];
}
