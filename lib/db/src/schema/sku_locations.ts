import { pgTable, text, timestamp, pgEnum, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const storageZoneEnum = pgEnum("storage_zone", ["fridge", "freezer", "ambient"]);

export const skuLocationsTable = pgTable("sku_locations", {
  sku: text("sku").primaryKey(),
  zone: storageZoneEnum("zone").notNull(),
  locationLabel: text("location_label").notNull(),
  // The fridge map (migration 0099): vertical door number + shelf letter
  // (A = top). Null for legacy free-text locations and the ambient tray.
  door: integer("door"),
  shelf: text("shelf"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSkuLocationSchema = createInsertSchema(skuLocationsTable);
export type InsertSkuLocation = z.infer<typeof insertSkuLocationSchema>;
export type SkuLocation = typeof skuLocationsTable.$inferSelect;
