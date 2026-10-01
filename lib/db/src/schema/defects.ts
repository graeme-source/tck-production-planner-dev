import { pgTable, serial, text, integer, timestamp, date, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { recipesTable } from "./recipes";

// Defects (migration 0139). Wonkies and dog bins are defects too but live on
// production_plan_items (migration 0131) — the Defects KPI adds them on read
// (api-server/src/lib/defects-kpi.ts); they are never copied in here.

/** Kinds of recorded defect — data, admin-editable, never hard-deleted. */
export const defectTypesTable = pgTable("defect_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** One recorded defect. occurred_on is a London calendar day. Soft delete. */
export const defectsTable = pgTable("defects", {
  id: serial("id").primaryKey(),
  occurredOn: date("occurred_on").notNull(),
  defectTypeId: integer("defect_type_id").notNull().references(() => defectTypesTable.id),
  recipeId: integer("recipe_id").references(() => recipesTable.id, { onDelete: "set null" }),
  packs: integer("packs").notNull().default(1),
  // A station key the app already uses (wrapping, packing…) or short free text.
  station: text("station"),
  orderRefs: text("order_refs"),
  note: text("note"),
  recordedById: integer("recorded_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  recordedByName: text("recorded_by_name"),
  updatedById: integer("updated_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedByName: text("updated_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  deletedById: integer("deleted_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  deletedByName: text("deleted_by_name"),
});

export type DefectType = typeof defectTypesTable.$inferSelect;
export type Defect = typeof defectsTable.$inferSelect;
