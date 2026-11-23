/**
 * Ingredients a production plan needs that nothing would ever order (Graeme,
 * 23 Nov 2026). Pure, tested (uncovered-ingredients-rules.test.ts); the
 * stored list and the writes are in uncovered-ingredients.ts. Objective C.
 *
 * The orders page only lists an ingredient when its stock check is on or it
 * has a kanban. Chestnut mushrooms had neither: 17 batches of a new recipe
 * needed 10.5 kg, and the page said nothing, because the calculation dropped
 * the ingredient without a word. So the plan's ingredients are checked here,
 * and any the page can't order for is named with how much the plan needs:
 *
 *   - no kanban and stock check off — nothing would ever put it on an order;
 *   - no supplier set — it has nowhere to be ordered from.
 *
 * Some ingredients are genuinely never ordered (tap water). A manager marks
 * those once ("we don't order this") and they stop being named.
 */

export interface PlanIngredientNeed {
  ingredientId: number;
  name: string;
  /** The ingredient's own unit — g, ml, each… */
  unit: string;
  /** How much of it the plan uses, in that unit. */
  totalRequired: number;
  stockCheckEnabled: boolean;
  kanbanEnabled: boolean;
  /** A kanban card for it has been scanned and is waiting to be ordered. */
  hasPulledKanban: boolean;
  supplierId: number | null;
  supplierName: string | null;
}

export type UncoveredReason = "no_kanban_no_stock_check" | "no_supplier";

export interface UncoveredIngredient {
  ingredientId: number;
  name: string;
  reason: UncoveredReason;
  /** "10.5 kg" — what the plan needs. */
  requiredLabel: string;
  supplierName: string | null;
}

const trim = (n: number, places: number) => String(Number(n.toFixed(places)));

/** A quantity as people say it: 10500 g is "10.5 kg", 250 g stays "250 g". */
export function quantityLabel(quantity: number, unit: string): string {
  const u = unit.trim().toLowerCase();
  if (u === "g" && quantity >= 1000) return `${trim(quantity / 1000, 2)} kg`;
  if (u === "ml" && quantity >= 1000) return `${trim(quantity / 1000, 2)} L`;
  const amount = trim(quantity, quantity < 10 ? 2 : quantity < 100 ? 1 : 0);
  return u ? `${amount} ${unit.trim()}` : amount;
}

/** Why the orders page can't order this ingredient, or null when it can. */
export function uncoveredReason(need: PlanIngredientNeed): UncoveredReason | null {
  if (!need.stockCheckEnabled && !need.kanbanEnabled && !need.hasPulledKanban) return "no_kanban_no_stock_check";
  if (need.supplierId == null) return "no_supplier";
  return null;
}

export interface UncoveredResult {
  /** To be warned about, by name. */
  uncovered: UncoveredIngredient[];
  /** Would be warned about, but a manager marked them as never ordered. */
  notOrdered: UncoveredIngredient[];
}

/** The plan's ingredients that the orders page would silently leave out.
 *  `notOrderedIds` are the ones a manager has said are never ordered. */
export function uncoveredIngredients(needs: PlanIngredientNeed[], notOrderedIds: ReadonlySet<number>): UncoveredResult {
  const uncovered: UncoveredIngredient[] = [];
  const notOrdered: UncoveredIngredient[] = [];
  for (const need of needs) {
    if (!(need.totalRequired > 0)) continue;
    const reason = uncoveredReason(need);
    if (!reason) continue;
    const row: UncoveredIngredient = {
      ingredientId: need.ingredientId, name: need.name, reason,
      requiredLabel: quantityLabel(need.totalRequired, need.unit), supplierName: need.supplierName,
    };
    (notOrderedIds.has(need.ingredientId) ? notOrdered : uncovered).push(row);
  }
  const byName = (a: UncoveredIngredient, b: UncoveredIngredient) => a.name.localeCompare(b.name);
  return { uncovered: uncovered.sort(byName), notOrdered: notOrdered.sort(byName) };
}

export interface NotOrderedIngredient {
  id: number;
  name: string;
  by: string | null;
  at: string;
}

export function withNotOrdered(list: readonly NotOrderedIngredient[], entry: NotOrderedIngredient): NotOrderedIngredient[] {
  return [...list.filter(i => i.id !== entry.id), entry];
}
export function withoutNotOrdered(list: readonly NotOrderedIngredient[], ingredientId: number): NotOrderedIngredient[] {
  return list.filter(i => i.id !== ingredientId);
}
