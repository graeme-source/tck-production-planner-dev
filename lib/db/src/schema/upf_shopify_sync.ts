/**
 * UPF % pushed from the planner to Shopify product metafields
 * (custom.upf_percent). Created by migration 0214_upf_shopify_sync.sql; see
 * that file for the why. Written by api-server lib/upf-shopify-sync.ts.
 */
import { pgTable, text, numeric, timestamp } from "drizzle-orm/pg-core";

export const upfShopifySyncTable = pgTable("upf_shopify_sync", {
  productGid: text("product_gid").primaryKey(),
  productTitle: text("product_title"),
  recipeNames: text("recipe_names"),
  status: text("status").notNull(),
  upfPercent: numeric("upf_percent", { precision: 5, scale: 1 }),
  /** What we last wrote to Shopify; NULL = removed / not there. */
  publishedPercent: numeric("published_percent", { precision: 5, scale: 1 }),
  unclassified: text("unclassified"),
  lastError: text("last_error"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  writtenAt: timestamp("written_at", { withTimezone: true }),
});
