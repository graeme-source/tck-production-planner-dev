/**
 * UPF %, calories and protein per portion pushed from the planner to Shopify
 * product metafields. Created by migration 0214_upf_shopify_sync.sql; see
 * that file for the why. Written by api-server lib/upf-shopify-sync.ts.
 */
import { pgTable, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";

export const upfShopifySyncTable = pgTable("upf_shopify_sync", {
  productGid: text("product_gid").primaryKey(),
  productTitle: text("product_title"),
  recipeNames: text("recipe_names"),
  status: text("status").notNull(),
  upfPercent: numeric("upf_percent", { precision: 5, scale: 1 }),
  /** What we last wrote to Shopify; NULL = removed / not there. */
  upfPublished: numeric("upf_published", { precision: 5, scale: 1 }),
  upfHeld: text("upf_held"),
  kcalPerPortion: integer("kcal_per_portion"),
  kcalPublished: integer("kcal_published"),
  kcalHeld: text("kcal_held"),
  proteinPerPortion: numeric("protein_per_portion", { precision: 6, scale: 1 }),
  proteinPublished: numeric("protein_published", { precision: 6, scale: 1 }),
  proteinHeld: text("protein_held"),
  lastError: text("last_error"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  writtenAt: timestamp("written_at", { withTimezone: true }),
});
