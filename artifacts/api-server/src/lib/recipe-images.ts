import { db, skuBarcodesTable } from "@workspace/db";
import { isNotNull } from "drizzle-orm";
import { pickRecipeImages } from "./recipe-name-match";

export { pickRecipeImages };

/**
 * Best-effort recipe images from the Shopify variant cache (sku_barcodes).
 * The cache is small (one row per variant, ~200), so it's read whole and
 * matched in memory.
 */
export async function getRecipeImagesByName(names: string[]): Promise<Map<string, string>> {
  if (names.every(n => !n.trim())) return new Map();
  const rows = await db
    .select({ productTitle: skuBarcodesTable.productTitle, imageUrl: skuBarcodesTable.imageUrl })
    .from(skuBarcodesTable)
    .where(isNotNull(skuBarcodesTable.imageUrl));
  return pickRecipeImages(names, rows);
}
