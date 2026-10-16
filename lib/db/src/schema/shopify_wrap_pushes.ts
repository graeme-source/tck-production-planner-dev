import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { recipesTable } from "./recipes";
import { productionPlansTable, productionPlanItemsTable } from "./production_plans";

// Wrap-to-Shopify ledger (migration 0202): one row per wrapping-station
// freezer add ('wrap', +N) or take-back ('take_back', −N) for a recipe with
// shopify_push_on_wrap. event_key is UNIQUE and doubles as Shopify's
// idempotency key, so a double tap or a retry never adds stock twice.
// Rules: api-server lib/shopify-wrap-push-rules.ts (pure);
// writes: lib/shopify-wrap-push.ts.
export const shopifyWrapPushesTable = pgTable("shopify_wrap_pushes", {
  id: serial("id").primaryKey(),
  eventKey: text("event_key").notNull().unique(),
  kind: text("kind").notNull(), // 'wrap' | 'take_back'
  planId: integer("plan_id").notNull().references(() => productionPlansTable.id, { onDelete: "cascade" }),
  planItemId: integer("plan_item_id").notNull().references(() => productionPlanItemsTable.id, { onDelete: "cascade" }),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "restrict" }),
  variantId: text("variant_id"),
  locationId: text("location_id"),
  delta: integer("delta").notNull(),
  /** pending → sending → sent | failed | skipped */
  status: text("status").notNull().default("pending"),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  /** Shopify's "available" after the change, when it reported one. */
  quantityAfter: integer("quantity_after"),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  sentAt: timestamp("sent_at"),
});

export type ShopifyWrapPush = typeof shopifyWrapPushesTable.$inferSelect;
