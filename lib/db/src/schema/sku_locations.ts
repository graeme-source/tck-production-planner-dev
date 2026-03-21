import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const storageZoneEnum = pgEnum("storage_zone", ["fridge", "freezer", "ambient"]);

export const skuLocationsTable = pgTable("sku_locations", {
  sku: text("sku").primaryKey(),
  zone: storageZoneEnum("zone").notNull(),
  locationLabel: text("location_label").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSkuLocationSchema = createInsertSchema(skuLocationsTable);
export type InsertSkuLocation = z.infer<typeof insertSkuLocationSchema>;
export type SkuLocation = typeof skuLocationsTable.$inferSelect;
