/**
 * Combining two orders from the same supplier for the same delivery day
 * (Graeme, 6 Nov 2026: two AB Fruits orders for one van). Pure rules; the
 * writes are in lib/order-combine.ts. Objective B.
 */

export interface CombineOrder {
  id: number;
  supplierId: number;
  status: string;
  expectedDeliveryDate: string | null;
}

export interface CombineLine {
  ingredientId: number | null;
  description: string | null;
  quantityRequired: string;
  quantityOrdered: string;
  quantityReceived: string;
  unit: string;
  unitPrice: string | null;
  checkedOff: boolean;
  goodsInChecked: boolean;
  notes: string | null;
}

/** Why these two can't be combined, in words for the person; null = they can. */
export function combineBlocker(
  target: CombineOrder,
  source: CombineOrder,
  receivingStarted: boolean,
): string | null {
  if (target.id === source.id) return "That's the same order.";
  if (target.supplierId !== source.supplierId) return "Those orders are from different suppliers.";
  if (target.status !== "placed" || source.status !== "placed") return "Only placed orders that haven't been received can be combined.";
  if (!target.expectedDeliveryDate || target.expectedDeliveryDate !== source.expectedDeliveryDate) {
    return "Those orders are for different delivery days. Move one to the same day first.";
  }
  if (receivingStarted) return "Receiving has already started on one of those orders.";
  return null;
}

const number = (v: string | null) => Number(v ?? 0) || 0;
const sum = (a: string, b: string) => String(Math.round((number(a) + number(b)) * 10000) / 10000);

/** Same goods at the same price in the same unit. Lines with notes (pallet
 *  wording) never merge, because the wording describes that line's quantity. */
function sameGoods(a: CombineLine, b: CombineLine): boolean {
  if (a.notes || b.notes) return false;
  if (a.unit !== b.unit) return false;
  if ((a.unitPrice == null ? null : number(a.unitPrice)) !== (b.unitPrice == null ? null : number(b.unitPrice))) return false;
  if (a.ingredientId != null || b.ingredientId != null) return a.ingredientId === b.ingredientId;
  return (a.description ?? "").trim().toLowerCase() === (b.description ?? "").trim().toLowerCase();
}

export interface LineMergePlan<T> {
  /** Target lines whose quantities go up. */
  add: Array<{ line: T; quantityRequired: string; quantityOrdered: string; checkedOff: boolean }>;
  /** Source lines that move across as they are. */
  move: T[];
}

/** What happens to each source line. Nothing is ever dropped. */
export function planLineMerge<T extends CombineLine>(targetLines: readonly T[], sourceLines: readonly T[]): LineMergePlan<T> {
  const add = new Map<T, LineMergePlan<T>["add"][number]>();
  const move: T[] = [];
  for (const line of sourceLines) {
    const match = targetLines.find(t => sameGoods(t, line));
    if (!match) { move.push(line); continue; }
    const current = add.get(match) ?? { line: match, quantityRequired: match.quantityRequired, quantityOrdered: match.quantityOrdered, checkedOff: match.checkedOff };
    add.set(match, {
      line: match,
      quantityRequired: sum(current.quantityRequired, line.quantityRequired),
      quantityOrdered: sum(current.quantityOrdered, line.quantityOrdered),
      checkedOff: current.checkedOff && line.checkedOff,
    });
  }
  return { add: [...add.values()], move };
}
