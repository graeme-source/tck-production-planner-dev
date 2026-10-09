import { pgTable, serial, text, integer, timestamp, date, boolean, numeric } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { recipesTable } from "./recipes";
import { ingredientsTable } from "./ingredients";
import { subRecipesTable } from "./sub_recipes";

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
  // Packs affected — counts in the Defects KPI. 0 for waste that isn't
  // packs (2.3 kg of a sauce); ≥ 1 for finished packs (migration 0152).
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
  // ── Waste (migration 0152). NULL itemKind = a record from before then:
  // no item, no cost, counted by its packs as it always was. ──
  /** 'ingredient' | 'sub_recipe' | 'product' */
  itemKind: text("item_kind"),
  ingredientId: integer("ingredient_id").references(() => ingredientsTable.id, { onDelete: "set null" }),
  subRecipeId: integer("sub_recipe_id").references(() => subRecipesTable.id, { onDelete: "set null" }),
  /** Products only: 'pack' | 'eight_pack_bag' */
  packKind: text("pack_kind"),
  /** Snapshot of the item's name when recorded. */
  itemName: text("item_name"),
  quantity: numeric("quantity", { precision: 14, scale: 4 }),
  /** 'pack' | 'bag' | a weight/volume unit | the ingredient's count unit */
  quantityUnit: text("quantity_unit"),
  // Costs, SNAPSHOT when saved (api-server lib/waste-cost.ts).
  remakeMinutes: integer("remake_minutes"),
  hourlyRate: numeric("hourly_rate", { precision: 10, scale: 4 }),
  ingredientCost: numeric("ingredient_cost", { precision: 12, scale: 2 }),
  timeCost: numeric("time_cost", { precision: 12, scale: 2 }),
  /** Taken off that day's Team efficiency credited value. */
  lostValue: numeric("lost_value", { precision: 12, scale: 2 }),
});

export type DefectType = typeof defectTypesTable.$inferSelect;
export type Defect = typeof defectsTable.$inferSelect;
