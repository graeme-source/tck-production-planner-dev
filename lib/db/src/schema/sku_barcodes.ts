import { pgTable, text, timestamp, boolean, integer, serial, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { recipesTable } from "./recipes";

// ONE barcode per Shopify VARIANT (migrations 0017, 0034, 0161).
//
// The source of truth for scanning: a linked variant's barcode is set in the
// app (recipe page). The packing scanner (both scan paths), the pack label
// and the recipe page all read it, so a change scans at once and there is no
// second copy that can disagree. Shopify is only READ (one-time pull, hourly
// "Different in Shopify" check). Variants NOT linked to a recipe
// (sauces, desserts, F2F lines) follow Shopify — the hourly check refreshes
// them. Rules: @workspace/barcodes; DB side: api-server lib/barcode-store.ts.
//
// Keyed by variant id, NOT by SKU: TCK uses SKUs as shelf/bin labels ("1",
// "3b", "5c"), so many unrelated products share one SKU. A SKU-keyed table
// collapses them into a single row and the picker ends up showing one
// product's title with another's barcode and image.
//
// The table name is historical (it began as a SKU cache).
export const skuBarcodesTable = pgTable("sku_barcodes", {
  variantId: text("variant_id").primaryKey(),
  sku: text("sku"),
  /** Ours. NULL = no barcode yet (a linked variant still has a row). */
  barcode: text("barcode"),
  productTitle: text("product_title"),
  variantTitle: text("variant_title"),
  imageUrl: text("image_url"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  shopifyProductId: text("shopify_product_id"),
  /** What Shopify had at the last check. */
  shopifyBarcode: text("shopify_barcode"),
  shopifyCheckedAt: timestamp("shopify_checked_at", { withTimezone: true }),
  /** The variant wasn't in Shopify at the last check. */
  shopifyMissing: boolean("shopify_missing").notNull().default(false),
  /** Where ours came from: 'shopify' | 'app' | 'label'. */
  barcodeSource: text("barcode_source").notNull().default("shopify"),
  barcodeSetAt: timestamp("barcode_set_at", { withTimezone: true }),
  barcodeSetById: integer("barcode_set_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  barcodeSetByName: text("barcode_set_by_name"),
  /** 'active' | 'draft' | 'archived' at the last check — retired products
   *  never claim a barcode (lib/barcodes identity.ts). */
  shopifyProductStatus: text("shopify_product_status"),
  /** Variant id this listing is the same physical product as (a person said
   *  so) — it may share that product's barcode. */
  sameProductAs: text("same_product_as"),
});

export const insertSkuBarcodeSchema = createInsertSchema(skuBarcodesTable);
export type InsertSkuBarcode = z.infer<typeof insertSkuBarcodeSchema>;
export type SkuBarcode = typeof skuBarcodesTable.$inferSelect;

/** Every barcode set, "Use Shopify's", pull fill, follow and scan fill (0161). */
export const barcodeEventsTable = pgTable("barcode_events", {
  id: serial("id").primaryKey(),
  variantId: text("variant_id").notNull(),
  recipeId: integer("recipe_id").references(() => recipesTable.id, { onDelete: "set null" }),
  productName: text("product_name"),
  /** 'set' | 'move' | 'use-shopify' | 'same-product' | 'pull-fill' | 'follow' | 'scan-fill' */
  action: text("action").notNull(),
  oldBarcode: text("old_barcode"),
  newBarcode: text("new_barcode"),
  /** 'ok' | 'refused' */
  result: text("result").notNull(),
  message: text("message"),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  userName: text("user_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index("barcode_events_variant_idx").on(t.variantId, t.createdAt),
  index("barcode_events_created_idx").on(t.createdAt),
]);

export type BarcodeEvent = typeof barcodeEventsTable.$inferSelect;

/** Scans the packing screen refused or couldn't match (migration 0161). */
export const packingScanRejectionsTable = pgTable("packing_scan_rejections", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  userName: text("user_name"),
  orderId: text("order_id"),
  orderName: text("order_name"),
  code: text("code").notNull(),
  /** 'wrong-item' | 'ambiguous' | 'unknown-barcode' | 'no-match' | 'already-picked' */
  kind: text("kind").notNull(),
  message: text("message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("packing_scan_rejections_created_idx").on(t.createdAt)]);
