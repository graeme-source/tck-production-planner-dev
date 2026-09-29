/**
 * Ingredient deck assembly — the rules, no I/O (moved out of
 * routes/recipes.ts, 2026-09-29).
 *
 * Input is the recipe already resolved to grams: its own ingredient lines,
 * and each sub-recipe flattened to raw ingredients scaled to the weight used.
 * Output is the ordered deck.
 *
 * The rules:
 *  - A sub-recipe that is 25% or more of the product is a compound
 *    ingredient: "Calzone Dough (Flour, Water, …)". Anything smaller is
 *    broken up into the main list.
 *  - Each ingredient is named ONCE, at its combined weight. Entries combine
 *    when they PRINT THE SAME — not just when they're the same ingredient
 *    record: Cracked Black Pepper and Ground Black Pepper both declare
 *    "Black Pepper", so the label says it once (Graeme, 2026-09-29). The
 *    same inside a compound's brackets.
 *  - A declaration's trailing full stop is dropped ("Flavouring.," was
 *    appearing mid-list); the deck ends with one full stop of its own.
 *  - QUID percentages are worked out from the COMBINED weight, and apply if
 *    any of the combined lines is flagged.
 *  - Order is descending by weight.
 */
import { boldAllergens, ALLERGEN_DISPLAY } from "@workspace/allergens";

export interface DeckItem {
  ingredientId: number;
  name: string;
  quantityG: number;
  labelDeclaration: string | null;
  allergens: string[];
  isQuid?: boolean;
}

export interface DeckGroup {
  subRecipeId: number;
  name: string;
  labelDeclaration: string | null;
  totalQuantityG: number;
  isQuid: boolean;
  ingredients: DeckItem[];
}

export interface DeckEntry {
  type: "ingredient" | "compound";
  name: string;
  declaration: string;
  percentage: number;
  allergens: string[];
  isQuid: boolean;
  ingredientId?: number;
  subRecipeId?: number;
  subIngredients?: Array<{
    ingredientId: number;
    name: string;
    declaration: string;
    percentage: number;
    allergens: string[];
  }>;
}

/** Share of the product at or above which a sub-recipe stays bracketed. */
export const COMPOUND_THRESHOLD_PCT = 25;

/** The declaration as it should print: trimmed, no trailing full stops or commas. */
export function cleanDeclaration(declaration: string | null | undefined, fallbackName: string): string {
  const s = (declaration ?? "").trim().replace(/[\s.,;]+$/, "").trim();
  return s || fallbackName.trim();
}

/** Two entries combine when they print the same words (case and spacing aside). */
export function declarationKey(printed: string): string {
  return printed.toLowerCase().replace(/\s+/g, " ").trim();
}

const pctOf = (grams: number, totalG: number) => (totalG > 0 ? Math.round((grams / totalG) * 1000) / 10 : 0);
const display = (codes: Iterable<string>) => [...new Set([...codes].map(a => ALLERGEN_DISPLAY[a] || a))];

interface Pooled {
  ingredientId: number;
  name: string;
  printed: string;
  grams: number;
  allergens: Set<string>;
  isQuid: boolean;
}

function pool(items: DeckItem[]): Pooled[] {
  const byKey = new Map<string, Pooled>();
  for (const it of items) {
    const printed = cleanDeclaration(it.labelDeclaration, it.name);
    const key = declarationKey(printed);
    const existing = byKey.get(key);
    if (existing) {
      existing.grams += it.quantityG;
      for (const a of it.allergens) existing.allergens.add(a);
      existing.isQuid = existing.isQuid || !!it.isQuid;
    } else {
      byKey.set(key, {
        ingredientId: it.ingredientId, name: it.name, printed, grams: it.quantityG,
        allergens: new Set(it.allergens), isQuid: !!it.isQuid,
      });
    }
  }
  return [...byKey.values()];
}

export function buildDeck(direct: DeckItem[], groups: DeckGroup[]): { entries: DeckEntry[]; deckText: string; totalWeightG: number } {
  const totalWeightG = direct.reduce((s, i) => s + i.quantityG, 0) + groups.reduce((s, g) => s + g.totalQuantityG, 0);

  const loose: DeckItem[] = [...direct];
  const compounds: Array<{ group: DeckGroup; grams: number }> = [];
  for (const g of groups) {
    if (pctOf(g.totalQuantityG, totalWeightG) >= COMPOUND_THRESHOLD_PCT) compounds.push({ group: g, grams: g.totalQuantityG });
    else for (const si of g.ingredients) loose.push({ ...si, isQuid: false });
  }

  const ranked: Array<{ grams: number; entry: DeckEntry }> = [];

  for (const p of pool(loose)) {
    const pct = pctOf(p.grams, totalWeightG);
    const bolded = boldAllergens(p.printed);
    ranked.push({
      grams: p.grams,
      entry: {
        type: "ingredient",
        name: p.name,
        declaration: p.isQuid ? `${bolded} (${pct}%)` : bolded,
        percentage: pct,
        allergens: display(p.allergens),
        isQuid: p.isQuid,
        ingredientId: p.ingredientId,
      },
    });
  }

  for (const { group, grams } of compounds) {
    const pct = pctOf(grams, totalWeightG);
    const inner = pool(group.ingredients).sort((a, b) => b.grams - a.grams);
    const innerTotal = inner.reduce((s, i) => s + i.grams, 0);
    const subIngredients = inner.map(si => ({
      ingredientId: si.ingredientId,
      name: si.name,
      declaration: boldAllergens(si.printed),
      percentage: pctOf(si.grams, innerTotal),
      allergens: display(si.allergens),
    }));
    const boldedName = boldAllergens(cleanDeclaration(group.labelDeclaration, group.name));
    const list = subIngredients.map(s => s.declaration).join(", ");
    ranked.push({
      grams,
      entry: {
        type: "compound",
        name: group.name,
        declaration: group.isQuid ? `${boldedName} (${pct}%) (${list})` : `${boldedName} (${list})`,
        percentage: pct,
        allergens: display(group.ingredients.flatMap(i => i.allergens)),
        isQuid: group.isQuid,
        subRecipeId: group.subRecipeId,
        subIngredients,
      },
    });
  }

  ranked.sort((a, b) => b.grams - a.grams);
  const entries = ranked.map(r => r.entry);
  const deckText = entries.map(e => e.declaration).join(", ") + ".";
  return { entries, deckText, totalWeightG };
}
