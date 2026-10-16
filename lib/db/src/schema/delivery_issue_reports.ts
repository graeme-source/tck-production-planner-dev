import { pgTable, serial, text, integer, timestamp, date, numeric, boolean, customType } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { purchaseOrdersTable, purchaseOrderLinesTable } from "./ordering";
import { suppliersTable } from "./suppliers";
import { ingredientsTable } from "./ingredients";

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

// Delivery issues reported with photos (migration 0199, Graeme 2026-10-16).
// Photos of every affected item (use-by dates / damage showing), taken at
// goods-in and attached to the ONE supplier email per receive. Rules:
// lib/goods-in delivery-issues.ts (pure); writes: api-server
// lib/delivery-issue-report.ts.
export const deliveryIssuePhotosTable = pgTable("delivery_issue_photos", {
  id: serial("id").primaryKey(),
  purchaseOrderId: integer("purchase_order_id").notNull().references(() => purchaseOrdersTable.id, { onDelete: "cascade" }),
  mime: text("mime").notNull(),
  data: bytea("data").notNull(),
  sizeBytes: integer("size_bytes"),
  uploadedById: integer("uploaded_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  uploadedByName: text("uploaded_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type DeliveryIssuePhoto = typeof deliveryIssuePhotosTable.$inferSelect;

// One row per PO line marked Damaged / broken at goods-in. UNIQUE line id =
// a re-save never re-sends.
export const deliveryDamageReportsTable = pgTable("delivery_damage_reports", {
  id: serial("id").primaryKey(),
  purchaseOrderId: integer("purchase_order_id").notNull().references(() => purchaseOrdersTable.id, { onDelete: "cascade" }),
  purchaseOrderLineId: integer("purchase_order_line_id").notNull().unique().references(() => purchaseOrderLinesTable.id, { onDelete: "cascade" }),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  ingredientId: integer("ingredient_id").references(() => ingredientsTable.id, { onDelete: "set null" }),
  ingredientName: text("ingredient_name").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
  unit: text("unit"),
  note: text("note"),
  /** 'kept' | 'rejected' */
  disposition: text("disposition").notNull(),
  deliveryDate: date("delivery_date").notNull(),
  reportedById: integer("reported_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  reportedByName: text("reported_by_name"),
  reportedAt: timestamp("reported_at").notNull().defaultNow(),
  photoIds: integer("photo_ids").array().notNull().default([]),
  photosConfirmed: boolean("photos_confirmed").notNull().default(false),
  /** 'pending' | 'sent' | 'failed' | 'no_address' | 'skipped' */
  emailStatus: text("email_status").notNull().default("pending"),
  emailError: text("email_error"),
  emailedToName: text("emailed_to_name"),
  emailedTo: text("emailed_to"),
  emailedAt: timestamp("emailed_at"),
});

export type DeliveryDamageReport = typeof deliveryDamageReportsTable.$inferSelect;
