/**
 * How a goods-in quantity on a purchase-order line becomes stock — the one
 * conversion every receive path uses (receive, undo-receive, and the
 * unexpected-delivery flow, which goes through receive). Pure; no DB.
 *
 * Before this module the same four lines were copied three times inside
 * routes/deliveries.ts. Charter rules 2–3: one copy, reused.
 *
 * PO lines are stored either as a pack COUNT (unit "packs" / "bottles" /
 * "pallets") or in the ingredient's native unit (kg / g / l / pieces …).
 * Stock is always kept in the native unit, so a pack count is multiplied by
 * the ingredient's pack weight.
 */

const PACK_COUNT_UNITS = new Set(["packs", "bottles", "pallets"]);

/** True when a PO line's quantity is a count of packs rather than a weight. */
export function isPackCountUnit(unit: string | null | undefined): boolean {
  return unit != null && PACK_COUNT_UNITS.has(unit);
}

export interface StockLineInfo {
  /** The PO line's unit. */
  unit: string;
  /** Ingredient pack weight in its native unit (numeric string from the DB). */
  packWeight: string | number | null | undefined;
  /** Ingredient native unit. */
  ingredientUnit: string | null | undefined;
}

/**
 * The stock movement for `qty` of a PO line, in the ingredient's native unit.
 * A pack weight of 0/missing counts each pack as 1 unit (legacy behaviour —
 * unchanged here).
 */
export function stockQuantityForReceipt(
  qty: number,
  line: StockLineInfo,
): { quantity: number; unit: string } {
  if (isPackCountUnit(line.unit)) {
    const pw = Number(line.packWeight) || 1;
    return { quantity: qty * pw, unit: line.ingredientUnit ?? "kg" };
  }
  return { quantity: qty, unit: line.unit };
}

/**
 * How much NEW stock a receive submission adds for one line: the difference
 * between what the line now says was received and what it said before.
 * Re-submitting the same numbers (editing a receipt, a double tap) therefore
 * adds nothing — stock goes up once per delivery, not once per save.
 */
export function receiptDelta(previousReceived: number, newReceived: number): number {
  return newReceived - previousReceived;
}
