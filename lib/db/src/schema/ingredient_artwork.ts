import { pgTable, serial, text, timestamp, integer, customType, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { ingredientsTable } from "./ingredients";

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() { return "bytea"; },
});

/** Artwork files kept against an ingredient/supply — print-ready PDFs sent
 *  with an order (migration 0393). Stored byte for byte, uncompressed. */
export const ingredientArtworkTable = pgTable("ingredient_artwork", {
  id: serial("id").primaryKey(),
  ingredientId: integer("ingredient_id").notNull().references(() => ingredientsTable.id, { onDelete: "cascade" }),
  fileBlob: bytea("file_blob").notNull(),
  fileName: text("file_name").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  uploadedBy: integer("uploaded_by").references(() => usersTable.id, { onDelete: "set null" }),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
}, t => [index("ingredient_artwork_ingredient_idx").on(t.ingredientId)]);
