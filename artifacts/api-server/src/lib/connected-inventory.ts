/**
 * Connected Inventory — loading (Graeme, 10 Nov 2026). Objective C.
 * The product fridge items for some suppliers, with their Shopify on-hand
 * stock. Read-only from Shopify. The maths is in connected-inventory-rules.
 */
import { db, ingredientsTable } from "@workspace/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getVariantOnHand } from "../services/shopify";
import { connectedMaxUnits } from "./connected-inventory-rules";

export type ConnectedItem = {
  ingredient: typeof ingredientsTable.$inferSelect;
  maxUnits: number;
  unitsPerPack: number;
  /** Shopify on-hand in store units; null when Shopify didn't say, or isn't counting it. */
  onHandUnits: number | null;
  /** Shopify answered, but "Track quantity" is off for this product. */
  notCounted: boolean;
};

const unitsPer = (v: string | number | null) => (Number(v) > 0 ? Number(v) : 1);

export async function loadConnectedItems(supplierIds: number[]): Promise<ConnectedItem[]> {
  if (supplierIds.length === 0) return [];
  const rows = await db.select().from(ingredientsTable).where(and(
    eq(ingredientsTable.connectedInventory, true),
    isNotNull(ingredientsTable.shopifyVariantId),
    inArray(ingredientsTable.supplierId, supplierIds),
  ));
  const usable = rows.flatMap(r => {
    const variant = (r.shopifyVariantId ?? "").trim();
    const max = connectedMaxUnits(r);
    return variant !== "" && max ? [{ r, variant, maxUnits: max.maxUnits }] : [];
  });
  if (usable.length === 0) return [];
  const stock = await getVariantOnHand(usable.map(u => u.variant));
  return usable.map(({ r, variant, maxUnits }) => ({
    ingredient: r,
    maxUnits,
    unitsPerPack: unitsPer(r.shopifyUnitsPerPack),
    onHandUnits: stock.untracked.has(variant) ? null : stock.map[variant] ?? null,
    notCounted: stock.untracked.has(variant),
  }));
}

/** One item's settings on the ingredient form, with its Shopify stock now. */
export async function connectedInventoryView(id: number) {
  const [row] = await db.select().from(ingredientsTable).where(eq(ingredientsTable.id, id));
  if (!row) return null;
  const variant = (row.shopifyVariantId ?? "").trim();
  const stock = variant ? await getVariantOnHand([variant]) : null;
  const notCounted = stock?.untracked.has(variant) ?? false;
  const max = connectedMaxUnits(row);
  return {
    id: row.id,
    connectedInventory: row.connectedInventory,
    maxStockUnits: row.maxStockUnits ?? null,
    /** What it fills to, and the kanban it came from (null = typed). */
    maxUnits: max?.maxUnits ?? null,
    kanban: max?.kanban ?? null,
    linkedToShopify: variant !== "",
    unitsPerPack: unitsPer(row.shopifyUnitsPerPack),
    onHandUnits: notCounted ? null : stock?.map[variant] ?? null,
    notCounted,
  };
}
