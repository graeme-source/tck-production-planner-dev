import { pgTable, integer, text, timestamp, customType } from "drizzle-orm/pg-core";
import { recipesTable } from "./recipes";
import { usersTable } from "./users";

// Inline bytea, as the other photos in the app (curiosity, collections).
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

/**
 * "Create Shopify product" from a recipe (migration 0345). Objective A.
 * The listing description itself is recipes.shopify_listing_description.
 */

/** One product photo per recipe (≥ 1000 × 750 px), sent to the product's
 *  media when the app makes the Shopify product. */
export const recipeProductImagesTable = pgTable("recipe_product_images", {
  recipeId: integer("recipe_id").primaryKey().references(() => recipesTable.id, { onDelete: "cascade" }),
  data: bytea("data").notNull(),
  mimeType: text("mime_type").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  byteSize: integer("byte_size").notNull(),
  filename: text("filename"),
  uploadedById: integer("uploaded_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  uploadedByName: text("uploaded_by_name"),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

/** The product the app made for a recipe — stored the moment Shopify returns
 *  its id, so a failure part-way through can't lead to a second duplicate. */
export const recipeShopifyProductsTable = pgTable("recipe_shopify_products", {
  recipeId: integer("recipe_id").primaryKey().references(() => recipesTable.id, { onDelete: "cascade" }),
  shopifyProductId: text("shopify_product_id").notNull(),
  productTitle: text("product_title"),
  templateProductId: text("template_product_id"),
  // created (duplicated, details not all written yet) | complete
  state: text("state").notNull().default("created"),
  lastError: text("last_error"),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  updatedByName: text("updated_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
