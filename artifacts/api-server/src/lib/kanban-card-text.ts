/**
 * The words on a kanban card — pure (objective C).
 *
 * Moved from the inventory page's old print popup so the PDF says exactly
 * what the popup said. The card follows the ingredient's KANBAN unit
 * (pack/bottle/pallet), not the stock-check weight unit — "1 pack", never
 * "1 kg", when the kanban is configured in packs. "weight" is the only
 * kanban unit that means the ingredient's native unit. ("packs" kept for
 * legacy rows saved plural.) A named pack (#327) reads "2 boxes".
 */
import { packNoun } from "@workspace/units";

export interface KanbanCardSource {
  id: number;
  name: string;
  unit: string;
  kanbanQuantity: number;
  kanbanUnit: string;
  kanbanOrderAmount: number | null;
  supplier: string | null;
  supplierPartNumber: string | null;
  location: string | null;
  packName: string | null;
}

export interface KanbanCardText {
  id: number;
  name: string;
  pullWhen: string;
  orderAmount: string;
  location: string;
  supplier: string;
  partNumber: string | null;
}

export function kanbanUnitLabel(kanbanUnit: string, unit: string, qty: number, packName: string | null): string {
  switch (kanbanUnit) {
    case "pack": case "packs": return packNoun("pack", qty, packName);
    case "bottle": return qty === 1 ? "bottle" : "bottles";
    case "pallet": return qty === 1 ? "pallet" : "pallets";
    default: return unit;
  }
}

const fmtQty = (n: number): string => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));

export function kanbanCardText(c: KanbanCardSource): KanbanCardText {
  const label = (q: number) => `${fmtQty(q)} ${kanbanUnitLabel(c.kanbanUnit, c.unit, q, c.packName)}`;
  return {
    id: c.id,
    name: c.name.trim(),
    pullWhen: c.kanbanQuantity > 0 ? label(c.kanbanQuantity) : "Not set",
    orderAmount: c.kanbanOrderAmount ? label(c.kanbanOrderAmount) : "Not set",
    location: c.location?.trim() || "Not assigned",
    supplier: c.supplier?.trim() || "Not assigned",
    partNumber: c.supplierPartNumber?.trim() || null,
  };
}
