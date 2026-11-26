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
import { formatCount, formatPackSize, itemWord, kanbanOrderItemsText, kanbanPullItemsText, kanbanSingleItems, packNoun, packsToItems } from "@workspace/units";

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
  /** Kanban in single items (26 Nov 2026): "bag" + 10 a box → the card
   *  counts bags, the order still counts boxes. Optional = off. */
  kanbanItemName?: string | null;
  kanbanItemsPerPack?: number | null;
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

/** One storage assignment as it reads on a card — "Dry Store · Rack A1 ·
 *  Top shelf" (#357). Rack and shelf are free text typed by the team, so a
 *  label that already says "rack"/"shelf" is left alone; a bare code gets the
 *  word in front ("Rack A1", "Shelf 3"); a bare word reads naturally
 *  ("Top shelf"). Blank parts are dropped. */
export interface KanbanLocationParts {
  name: string;
  rackLabel: string | null;
  shelfLabel: string | null;
}

const hasDigit = (v: string) => /\d/.test(v);

export function kanbanLocationLabel(l: KanbanLocationParts): string {
  const name = l.name.trim();
  const rack = l.rackLabel?.trim() ?? "";
  const shelf = l.shelfLabel?.trim() ?? "";
  const parts = [name];
  if (rack) parts.push(/\brack\b/i.test(rack) ? rack : `Rack ${rack}`);
  if (shelf) parts.push(/\bshelf\b/i.test(shelf) ? shelf : hasDigit(shelf) || shelf.length <= 2 ? `Shelf ${shelf}` : `${shelf} shelf`);
  return parts.filter(Boolean).join(" · ");
}

/** Every assignment for one item, in order, as one card line. */
export function kanbanLocationsLabel(locations: KanbanLocationParts[]): string | null {
  return locations.map(kanbanLocationLabel).filter(Boolean).join(", ") || null;
}

const fmtQty = (n: number): string => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));

export function kanbanCardText(c: KanbanCardSource): KanbanCardText {
  const label = (q: number) => `${fmtQty(q)} ${kanbanUnitLabel(c.kanbanUnit, c.unit, q, c.packName)}`;
  const items = kanbanSingleItems(c);
  return {
    id: c.id,
    name: c.name.trim(),
    pullWhen: c.kanbanQuantity > 0 ? (items ? kanbanPullItemsText(c.kanbanQuantity, items) : label(c.kanbanQuantity)) : "Not set",
    orderAmount: c.kanbanOrderAmount ? (items ? kanbanOrderItemsText(c.kanbanOrderAmount, items, c.packName) : label(c.kanbanOrderAmount)) : "Not set",
    location: c.location?.trim() || "Not assigned",
    supplier: c.supplier?.trim() || "Not assigned",
    partNumber: c.supplierPartNumber?.trim() || null,
  };
}

/**
 * The unit words after the order quantity when a card is scanned ("3" +
 * "boxes (30 kg)"), and in the scan reply. Before 26 Nov 2026 this said
 * "packs" whatever the pack was called, so pepperoni read "3 packs" when
 * the supplier sells boxes of 10 kg. A named pack says its name; a pack
 * with a size says what it adds up to; single items say how many.
 */
export function kanbanOrderUnitLabel(orderQty: number, ing: {
  kanbanUnit: string | null;
  unit: string;
  packName: string | null;
  packWeight: number | string | null;
  kanbanItemName?: string | null;
  kanbanItemsPerPack?: number | null;
}): string {
  const kanbanUnit = ing.kanbanUnit ?? "weight";
  if (kanbanUnit !== "pack" && kanbanUnit !== "packs") return kanbanUnitLabel(kanbanUnit, ing.unit, orderQty, ing.packName);
  const noun = packNoun("pack", orderQty, ing.packName);
  const extras: string[] = [];
  const items = kanbanSingleItems({ kanbanUnit, kanbanItemName: ing.kanbanItemName, kanbanItemsPerPack: ing.kanbanItemsPerPack });
  if (items) {
    const n = packsToItems(orderQty, items);
    extras.push(`${formatCount(n)} ${itemWord(items.name, n)}`);
  }
  const pw = Number(ing.packWeight);
  if (Number.isFinite(pw) && pw > 0 && pw !== 1 && ing.unit) extras.push(formatPackSize(orderQty * pw, ing.unit));
  return extras.length ? `${noun} (${extras.join(", ")})` : noun;
}
