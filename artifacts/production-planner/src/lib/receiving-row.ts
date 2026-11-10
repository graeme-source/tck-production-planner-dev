/**
 * One compact row per line on the goods-in (receive delivery) dialog
 * (Graeme, 9 Nov 2026: "constantly had to scroll up and down" on a 10-line
 * order). Objective D.
 *
 * Pure helpers the row uses: how its quantity is shown and stepped (whole
 * packs for pack-counted ingredients, else the line unit), which colour the
 * row takes, and the column layout. The maths is lifted unchanged from the
 * old card layout in pages/deliveries.tsx so the stored quantities are
 * exactly what they were.
 */

export type RowDecision = "received" | "not_received" | null;

export interface RowQtyLine {
  unit: string;
  quantityOrdered: number;
  quantityReceived: number;
  stockInPacks?: boolean;
  packWeight?: number | null;
}

/** Units where the stored quantity is already a count of packs. */
const PACK_UNITS = new Set(["packs", "bottles", "pallets"]);

/** How a line's quantities are shown and edited. */
export function rowQuantity(line: RowQtyLine) {
  // Pack-counted ingredients: the team counts whole packs off the truck, but
  // the stored quantity stays in the ingredient's native unit unless the line
  // is already stored as a pack count.
  const inPacks = !!line.stockInPacks && (line.packWeight ?? 0) > 0;
  const isPackUnit = PACK_UNITS.has(line.unit);
  const pw = Number(line.packWeight) || 1;
  const step = inPacks ? 1 : 0.5;
  const orderedPacks = inPacks
    ? (isPackUnit ? line.quantityOrdered : Math.round(line.quantityOrdered / pw))
    : 0;
  /** What the Received box shows. */
  const receivedShown = inPacks
    ? (isPackUnit ? line.quantityReceived : Math.round(line.quantityReceived / pw))
    : line.quantityReceived;
  /** A number typed in the box → the stored quantity. */
  const storedFromTyped = (n: number) => (inPacks ? (isPackUnit ? n : n * pw) : n);
  /** The −/+ buttons: the stored quantity after stepping by `delta`
   *  (in what the box shows), never below 0. */
  const storedAfterStep = (delta: number) => {
    const current = Number(line.quantityReceived) || 0;
    const shown = inPacks ? (isPackUnit ? current : current / pw) : current;
    const next = Math.max(0, shown + delta);
    return inPacks ? (isPackUnit ? next : next * pw) : Number(next.toFixed(2));
  };
  return { inPacks, isPackUnit, step, orderedPacks, receivedShown, storedFromTyped, storedAfterStep };
}

/** Typing or stepping a quantity also decides the line: anything above 0 is
 *  Received, 0 is Not received. */
export function decisionForQuantity(stored: number): Exclude<RowDecision, null> {
  return stored > 0 ? "received" : "not_received";
}

export type RowTone =
  | "not_received"
  | "shelf_life_short"
  | "use_by_missing"
  | "discrepancy"
  | "received"
  | "undecided";

/** The row's colour, most urgent first. */
export function rowTone(f: {
  decision: RowDecision;
  quantityOrdered: number;
  quantityReceived: number;
  /** A received line whose use-by is under the minimum shelf life. */
  shelfLifeShort: boolean;
  requiresUseByDate: boolean;
  useByDate: string;
}): RowTone {
  if (f.decision === "not_received") return "not_received";
  const received = f.decision === "received";
  if (received && f.shelfLifeShort) return "shelf_life_short";
  if (received && f.requiresUseByDate && f.quantityReceived > 0 && !f.useByDate) return "use_by_missing";
  if (received && f.quantityReceived !== f.quantityOrdered) return "discrepancy";
  if (received) return "received";
  return "undecided";
}

/** Grid columns for a row on tablet and desktop: Arrived? (tick / cross,
 *  spaced well apart so the wrong one isn't tapped — Graeme, 10 Nov 2026),
 *  item (ordered quantity then name; takes the rest, wraps — never
 *  truncated), the Received stepper, Use-by (only when some line on the
 *  order has one), and the Damaged button. Each row is its own grid, so
 *  every track except the item is a fixed width — that is what keeps the
 *  columns lined up under the header. `wide` = desktop widths. */
export function receivingColumns(opts: { anyUseBy: boolean; wide: boolean }): string {
  return [
    "8rem",
    "minmax(10rem,1fr)",
    opts.wide ? "10rem" : "9.5rem",
    ...(opts.anyUseBy ? [opts.wide ? "9.5rem" : "8.5rem"] : []),
    "3.5rem",
  ].join(" ");
}
