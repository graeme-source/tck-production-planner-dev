import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Barcode lookup per Shopify VARIANT, populated from Shopify variants. Used
// by the fulfilment picker so a hand scanner can mark a line item picked by
// scanning the printed barcode on the product label.
//
// Keyed by variant id, NOT by SKU: TCK uses SKUs as shelf/bin labels ("1",
// "3b", "5c"), so many unrelated products share one SKU. A SKU-keyed cache
// collapses them into a single row and the picker ends up showing one
// product's title with another's barcode and image.
export const skuBarcodesTable = pgTable("sku_barcodes", {
  variantId: text("variant_id").primaryKey(),
  sku: text("sku"),
  barcode: text("barcode").notNull(),
  productTitle: text("product_title"),
  variantTitle: text("variant_title"),
  imageUrl: text("image_url"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSkuBarcodeSchema = createInsertSchema(skuBarcodesTable);
export type InsertSkuBarcode = z.infer<typeof insertSkuBarcodeSchema>;
export type SkuBarcode = typeof skuBarcodesTable.$inferSelect;
