/**
 * Traceability, stage 1 (migration 0385). Which ingredients are traced, and
 * one row per pack of them opened, with a photo of its label and the batch
 * code and use-by read from it. See artifacts/api-server/src/lib/traceability.ts
 * for how a batch counts as "in use". Objectives B and D.
 */
import { pgTable, serial, integer, text, timestamp, date, customType, index } from "drizzle-orm/pg-core";
import { ingredientsTable } from "./ingredients";
import { usersTable } from "./users";

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({ dataType() { return "bytea"; } });

export const tracedIngredientsTable = pgTable("traced_ingredients", {
  ingredientId: integer("ingredient_id").primaryKey().references(() => ingredientsTable.id, { onDelete: "cascade" }),
  addedAt: timestamp("added_at").notNull().defaultNow(),
  addedByName: text("added_by_name"),
});

export const ingredientLotOpensTable = pgTable("ingredient_lot_opens", {
  id: serial("id").primaryKey(),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredientsTable.id, { onDelete: "cascade" }),
  photo: bytea("photo"),
  photoMime: text("photo_mime"),
  batchCode: text("batch_code"),
  useBy: date("use_by"),
  /** 'ai' | 'person' | 'copied' | null */
  readBy: text("read_by"),
  sameAsId: integer("same_as_id"),
  station: text("station"),
  openedByUserId: integer("opened_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  openedByName: text("opened_by_name"),
  openedAt: timestamp("opened_at").notNull().defaultNow(),
}, t => ({
  ingredientIdx: index("ingredient_lot_opens_ingredient_idx").on(t.ingredientId, t.openedAt),
}));

export type IngredientLotOpen = typeof ingredientLotOpensTable.$inferSelect;
