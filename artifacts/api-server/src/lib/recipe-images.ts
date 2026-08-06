import { db, skuBarcodesTable } from "@workspace/db";
import { sql, inArray } from "drizzle-orm";

/**
 * Best-effort recipe images from the Shopify variant cache (sku_barcodes),
 * matched by lower(product_title) = lower(recipe name) — the same source and
 * matching rule the spec-sheet barcode lookup uses. Returns a map keyed by
 * the LOWERCASED trimmed recipe name; misses are simply absent.
 */
export async function getRecipeImagesByName(names: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(names.map(n => n.trim().toLowerCase()).filter(Boolean))];
  const map = new Map<string, string>();
  if (wanted.length === 0) return map;

  const rows = await db
    .select({ productTitle: skuBarcodesTable.productTitle, imageUrl: skuBarcodesTable.imageUrl })
    .from(skuBarcodesTable)
    .where(inArray(sql`lower(trim(${skuBarcodesTable.productTitle}))`, wanted));

  for (const row of rows) {
    const key = row.productTitle?.trim().toLowerCase();
    // First variant with an image wins; later rows don't overwrite.
    if (key && row.imageUrl && !map.has(key)) map.set(key, row.imageUrl);
  }
  return map;
}
