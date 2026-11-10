/**
 * Connected Inventory — loading (Graeme, 10 Nov 2026). Objective C.
 * The product fridge items for some suppliers, with their Shopify on-hand
 * stock. Read-only from Shopify. The maths is in connected-inventory-rules.
 */
import { db, ingredientsTable } from "@workspace/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getVariantOnHandQuantities } from "../services/shopify";

export type ConnectedItem = {
  ingredient: typeof ingredientsTable.$inferSelect;
  maxUnits: number;
  unitsPerPack: number;
  /** Shopify on-hand in store units; null when Shopify didn't say. */
  onHandUnits: number | null;
};

export async function loadConnectedItems(supplierIds: number[]): Promise<ConnectedItem[]> {
  if (supplierIds.length === 0) return [];
  const rows = await db.select().from(ingredientsTable).where(and(
    eq(ingredientsTable.connectedInventory, true),
    isNotNull(ingredientsTable.shopifyVariantId),
    isNotNull(ingredientsTable.maxStockUnits),
    inArray(ingredientsTable.supplierId, supplierIds),
  ));
  const usable = rows.filter(r => (r.maxStockUnits ?? 0) > 0 && (r.shopifyVariantId ?? "").trim() !== "");
  if (usable.length === 0) return [];
  const onHand = await getVariantOnHandQuantities(usable.map(r => r.shopifyVariantId!.trim()));
  return usable.map(r => ({
    ingredient: r,
    maxUnits: r.maxStockUnits!,
    unitsPerPack: Number(r.shopifyUnitsPerPack) > 0 ? Number(r.shopifyUnitsPerPack) : 1,
    onHandUnits: onHand[r.shopifyVariantId!.trim()] ?? null,
  }));
}
