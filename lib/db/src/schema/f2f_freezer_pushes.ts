import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { recipesTable } from "./recipes";
import { productionPlansTable, productionPlanItemsTable } from "./production_plans";

// Freezer moves → the recipe's F2F product's Shopify stock (migration 0400).
// One row per move per recipe; event_key is UNIQUE and doubles as Shopify's
// idempotency key, so a double tap or a retry never adds the packs twice.
// Rules: api-server lib/f2f-freezer-push-rules.ts (pure);
// writes: lib/f2f-freezer-push.ts.
export const f2fFreezerPushesTable = pgTable("f2f_freezer_pushes", {
  id: serial("id").primaryKey(),
  eventKey: text("event_key").notNull().unique(),
  /** 'wrap_freezer' | 'wonky' | 'closing_check' */
  source: text("source").notNull(),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "restrict" }),
  planId: integer("plan_id").references(() => productionPlansTable.id, { onDelete: "set null" }),
  planItemId: integer("plan_item_id").references(() => productionPlanItemsTable.id, { onDelete: "set null" }),
  variantId: text("variant_id"),
  productTitle: text("product_title"),
  variantTitle: text("variant_title"),
  locationId: text("location_id"),
  delta: integer("delta").notNull(),
  /** pending → sending → sent | failed | skipped */
  status: text("status").notNull().default("pending"),
  /** 'writes_off' | 'untracked' when skipped */
  skipReason: text("skip_reason"),
  error: text("error"),
  note: text("note"),
  attempts: integer("attempts").notNull().default(0),
  quantityAfter: integer("quantity_after"),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  userName: text("user_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  sentAt: timestamp("sent_at"),
});

export type F2fFreezerPush = typeof f2fFreezerPushesTable.$inferSelect;

// "Create F2F product" from a recipe (migration 0399): who made it, and the
// claim + stored product id that stop a double tap or a re-run making two.
export const f2fProductCreationsTable = pgTable("f2f_product_creations", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull().unique().references(() => recipesTable.id, { onDelete: "cascade" }),
  mainProductId: text("main_product_id"),
  shopifyProductId: text("shopify_product_id"),
  productTitle: text("product_title"),
  linkedVariantId: text("linked_variant_id"),
  /** 'creating' | 'created' | 'complete' | 'failed' */
  state: text("state").notNull().default("creating"),
  lastError: text("last_error"),
  steps: jsonb("steps").$type<string[]>(),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type F2fProductCreation = typeof f2fProductCreationsTable.$inferSelect;
