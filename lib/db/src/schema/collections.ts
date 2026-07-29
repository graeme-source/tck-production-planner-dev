/**
 * Collections — goods leaving the unit, the mirror of a delivery.
 *
 * A driver arrives to collect something (returnable containers, equipment going
 * for repair, samples). The team ticks off what's actually handed over, takes
 * the driver's signature on the iPad, and optionally photographs the items with
 * the driver or in the vehicle.
 *
 * Nesting is DERIVED, not stored: a collection renders inside a delivery's
 * section when it shares the same supplier and date as a scheduled purchase
 * order. Deriving it means moving the delivery to another day cleanly detaches
 * the collection into a standalone card instead of leaving a stale FK pointing
 * at a delivery on a different day.
 *
 * While a collection is outstanding, its delivery cannot be received — the
 * collection is the thing most easily forgotten once the driver has gone, so
 * the delivery is held hostage to it and the UI renders it first.
 *
 * Signature and photo are stored inline as bytea, matching improvement
 * attachments and the Documents PDFs. A signature PNG is a few KB; the photo is
 * capped at the route.
 */
import { pgTable, serial, text, integer, numeric, boolean, timestamp, date, index, customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./users";
import { suppliersTable } from "./suppliers";

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const collectionsTable = pgTable("collections", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "restrict" }),
  collectionDate: date("collection_date").notNull(),
  // "scheduled" | "collected" | "cancelled"
  status: text("status").notNull().default("scheduled"),
  // What's being collected and why — shown on the card before the driver arrives.
  reference: text("reference"),
  notes: text("notes"),
  // Captured at hand-over.
  driverName: text("driver_name"),
  signatureBlob: bytea("signature_blob"),
  signatureMime: text("signature_mime"),
  photoBlob: bytea("photo_blob"),
  photoMime: text("photo_mime"),
  collectedAt: timestamp("collected_at"),
  collectedByUserId: integer("collected_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  collectedByName: text("collected_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  // The lookup the weekly view does on every render: which collections belong
  // to this supplier on this day?
  supplierDateIdx: index("ix_collections_supplier_date").on(t.supplierId, t.collectionDate),
  dateIdx: index("ix_collections_date").on(t.collectionDate),
}));

export const collectionLinesTable = pgTable("collection_lines", {
  id: serial("id").primaryKey(),
  collectionId: integer("collection_id").notNull().references(() => collectionsTable.id, { onDelete: "cascade" }),
  // Free text — collections are returns and one-offs (empty bottles, a broken
  // mixer), not stock lines, so there's deliberately no ingredient link and no
  // stock movement.
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull().default("1"),
  unit: text("unit").notNull().default("items"),
  // Ticked as each line is physically handed over.
  checkedOff: boolean("checked_off").notNull().default(false),
  // What actually went, when it differs from what was expected.
  quantityCollected: numeric("quantity_collected", { precision: 10, scale: 2 }),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => ({
  collectionIdx: index("ix_collection_lines_collection").on(t.collectionId),
}));

export type Collection = typeof collectionsTable.$inferSelect;
export type CollectionLine = typeof collectionLinesTable.$inferSelect;

export const insertCollectionSchema = createInsertSchema(collectionsTable).omit({ id: true, createdAt: true });
export const insertCollectionLineSchema = createInsertSchema(collectionLinesTable).omit({ id: true });
