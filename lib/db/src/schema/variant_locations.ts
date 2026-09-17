import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { storageZoneEnum } from "./sku_locations";

/**
 * Where a Shopify VARIANT lives in the fridge, freezer or on the ambient
 * shelf — the fridge map, and the single source of the picking walk.
 *
 * Keyed by variant, not SKU (migration 0112). A TCK SKU is a shelf label
 * shared by many products — 189 variants across 41 SKUs — so the old
 * SKU-keyed map could only hold 41 bins and silently dropped every product
 * that shared a label with one already placed.
 */
export const variantLocationsTable = pgTable("variant_locations", {
  variantId: text("variant_id").primaryKey(),
  zone: storageZoneEnum("zone").notNull(),
  /** Display string shown on pick rows ("3B"). */
  locationLabel: text("location_label").notNull(),
  /** Vertical door number + shelf letter (A = top); null for the ambient tray. */
  door: integer("door"),
  shelf: text("shelf"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertVariantLocationSchema = createInsertSchema(variantLocationsTable);
export type InsertVariantLocation = z.infer<typeof insertVariantLocationSchema>;
export type VariantLocation = typeof variantLocationsTable.$inferSelect;
