import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Barcode lookup per SKU, populated from Shopify variants. Used by the
// fulfilment picker so a hand scanner can mark a line item picked by
// scanning the printed barcode on the product label.
export const skuBarcodesTable = pgTable("sku_barcodes", {
  sku: text("sku").primaryKey(),
  barcode: text("barcode").notNull(),
  productTitle: text("product_title"),
  variantTitle: text("variant_title"),
  imageUrl: text("image_url"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSkuBarcodeSchema = createInsertSchema(skuBarcodesTable);
export type InsertSkuBarcode = z.infer<typeof insertSkuBarcodeSchema>;
export type SkuBarcode = typeof skuBarcodesTable.$inferSelect;
