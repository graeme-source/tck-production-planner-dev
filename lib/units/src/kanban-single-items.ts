/**
 * Kanban in single items (Graeme, 26 Nov 2026 — pepperoni). The supplier
 * sells BOXES of 10 bags; once a box comes in, the bags go loose into the
 * two-bin system. So the card on the shelf counts bags ("Pull when 15 bags
 * left") while the order still counts boxes ("Order 3 boxes — 30 kg").
 *
 * Display only. The pull-at figure (ingredients.kanban_quantity) is still
 * stored in supplier packs, so ordering, stock left and the connected
 * maximum keep working unchanged; this module turns it into items for the
 * card and the editor, and turns typed items back into packs.
 * Only applies to items whose kanban counts packs. Objective C.
 */
import { formatCount, isPackName, packNoun, pluralPackName, type PackName } from "./order-quantity";

export interface KanbanSingleItemsSource {
  kanbanUnit: string | null | undefined;
  kanbanItemName?: string | null | undefined;
  kanbanItemsPerPack?: number | string | null | undefined;
}

export interface KanbanSingleItems {
  /** What one item is called: "bag". */
  name: PackName;
  /** Items in one supplier pack: 10. */
  perPack: number;
}

/** The setting, or null when it's off or can't apply (a pallet / own-unit kanban). */
export function kanbanSingleItems(i: KanbanSingleItemsSource): KanbanSingleItems | null {
  if (i.kanbanUnit !== "pack" && i.kanbanUnit !== "packs") return null;
  const per = Number(i.kanbanItemsPerPack);
  if (!Number.isFinite(per) || per < 2 || !isPackName(i.kanbanItemName)) return null;
  return { name: i.kanbanItemName, perPack: Math.round(per) };
}

/** "bag" / "bags". */
export function itemWord(name: PackName, n: number): string {
  return n === 1 ? name : pluralPackName(name);
}

/** Packs → items, for showing: 1.5 boxes of 10 → 15 (2 dp, so 7 ÷ 12 stored
 *  as 0.5833 still reads 7). */
export function packsToItems(packs: number, s: KanbanSingleItems): number {
  return Math.round(packs * s.perPack * 100) / 100;
}

/** Items typed in → packs, for storing (4 dp, the column's scale). */
export function itemsToPacks(items: number, s: KanbanSingleItems): number {
  return Math.round((items / s.perPack) * 10000) / 10000;
}

/** "15 bags" for a pull-at figure stored as 1.5 packs. */
export function kanbanPullItemsText(packs: number, s: KanbanSingleItems): string {
  const n = packsToItems(packs, s);
  return `${formatCount(n)} ${itemWord(s.name, n)}`;
}

/** "3 boxes (30 bags)" — an order of whole packs, with the items it brings. */
export function kanbanOrderItemsText(packs: number, s: KanbanSingleItems, packName: string | null | undefined): string {
  const items = packsToItems(packs, s);
  return `${formatCount(packs)} ${packNoun("pack", packs, packName)} (${formatCount(items)} ${itemWord(s.name, items)})`;
}
