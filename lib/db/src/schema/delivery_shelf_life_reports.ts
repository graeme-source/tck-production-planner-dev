import { pgTable, serial, text, integer, timestamp, date, numeric, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { purchaseOrdersTable, purchaseOrderLinesTable } from "./ordering";
import { suppliersTable } from "./suppliers";
import { ingredientsTable } from "./ingredients";

// Short shelf life at goods-in (migration 0197): one row per PO line that
// arrived with less shelf life than the ingredient's minimum — the receiver's
// decision and the email to the supplier's account manager. UNIQUE line id =
// a re-save never re-sends. Rule: lib/goods-in shelf-life.ts (pure); writes:
// api-server lib/shelf-life-report.ts.
export const deliveryShelfLifeReportsTable = pgTable("delivery_shelf_life_reports", {
  id: serial("id").primaryKey(),
  purchaseOrderId: integer("purchase_order_id").notNull().references(() => purchaseOrdersTable.id, { onDelete: "cascade" }),
  purchaseOrderLineId: integer("purchase_order_line_id").notNull().unique().references(() => purchaseOrderLinesTable.id, { onDelete: "cascade" }),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  ingredientId: integer("ingredient_id").references(() => ingredientsTable.id, { onDelete: "set null" }),
  ingredientName: text("ingredient_name").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 4 }),
  unit: text("unit"),
  deliveryDate: date("delivery_date").notNull(),
  useByDate: date("use_by_date").notNull(),
  shelfLifeDays: integer("shelf_life_days").notNull(),
  minShelfLifeDays: integer("min_shelf_life_days").notNull(),
  /** 'accepted' | 'rejected' */
  decision: text("decision").notNull(),
  decidedById: integer("decided_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  decidedByName: text("decided_by_name"),
  decidedAt: timestamp("decided_at").notNull().defaultNow(),
  /** 'pending' | 'sent' | 'failed' | 'no_address' | 'skipped' */
  emailStatus: text("email_status").notNull().default("pending"),
  emailError: text("email_error"),
  emailedToName: text("emailed_to_name"),
  emailedTo: text("emailed_to"),
  emailedAt: timestamp("emailed_at"),
  /** Photos sent with the report (delivery_issue_photos, migration 0198). */
  photoIds: integer("photo_ids").array().notNull().default([]),
  /** The receiver ticked that every affected item was in the photos. */
  photosConfirmed: boolean("photos_confirmed").notNull().default(false),
});

export type DeliveryShelfLifeReport = typeof deliveryShelfLifeReportsTable.$inferSelect;
