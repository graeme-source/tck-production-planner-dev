import { pgTable, serial, text, integer, timestamp, date, boolean, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { recipesTable } from "./recipes";

// Test-box scheduling tool (migrations 0136 + 0146). Deadlines are computed
// on read from the launch date, each delivery date and supplier lead times —
// see api-server/src/lib/test-box-schedule.ts — never stored.
export const testBoxesTable = pgTable("test_boxes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // The VIP Calzoney Club launch — the box's first sale (0146).
  launchDate: date("launch_date").notNull(),
  // Optional: only exists once someone adds it (0146).
  publicLaunchDate: date("public_launch_date"),
  // Whose to-do list the checklist lands on (0146; defaults to the creator).
  ownerId: integer("owner_id").references(() => usersTable.id, { onDelete: "set null" }),
  // The one planned launch email + social-post note the box made (0146) —
  // plain ids here (no Drizzle reference) to avoid a schema import cycle
  // with marketing.ts; the foreign keys are in the migration.
  launchEmailId: integer("launch_email_id"),
  socialNoteEventId: integer("social_note_event_id"),
  // The box's Shopify smart collection (rule: tag = box name), made once by
  // "Create Shopify products" (0147). Shopify's numeric id, as text.
  shopifyCollectionId: text("shopify_collection_id"),
  // LEGACY (0136) — superseded by test_box_deliveries in 0146; not written.
  deliveryDate: date("delivery_date"),
  // LEGACY (0136) — no longer used: the launch is always VIP first.
  audience: text("audience").notNull().default("vip_then_public"),
  // planning | selling | ordering | producing | delivered | cancelled
  status: text("status").notNull().default("planning"),
  notes: text("notes"),
  bufferPct: integer("buffer_pct").notNull().default(25),
  bufferDays: integer("buffer_days").notNull().default(2),
  // LEGACY (0136) — no fixed selling window any more; not used.
  sellingDays: integer("selling_days").notNull().default(14),
  ordersCloseDays: integer("orders_close_days").notNull().default(2),
  // LEGACY (0136) — replaced by public_launch_date; not used.
  vipHeadStartDays: integer("vip_head_start_days").notNull().default(3),
  // Box-wide default for a new delivery's expected boxes.
  expectedBoxes: integer("expected_boxes"),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  updatedById: integer("updated_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedByName: text("updated_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  deletedById: integer("deleted_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  deletedByName: text("deleted_by_name"),
});

export const testBoxRecipesTable = pgTable("test_box_recipes", {
  id: serial("id").primaryKey(),
  testBoxId: integer("test_box_id").notNull().references(() => testBoxesTable.id, { onDelete: "cascade" }),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
}, (t) => [unique().on(t.testBoxId, t.recipeId)]);

export const testBoxTasksTable = pgTable("test_box_tasks", {
  id: serial("id").primaryKey(),
  testBoxId: integer("test_box_id").notNull().references(() => testBoxesTable.id, { onDelete: "cascade" }),
  taskKey: text("task_key").notNull(),
  done: boolean("done").notNull().default(false),
  doneById: integer("done_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  doneByName: text("done_by_name"),
  doneAt: timestamp("done_at"),
  // The owner's to-do that shows this task (0146). The tick above is the
  // source of truth; the to-do's open/done follows it (lib/test-box-todos.ts).
  // No Drizzle reference: todo_tasks has no Drizzle schema (FK in 0146).
  todoTaskId: integer("todo_task_id"),
}, (t) => [unique().on(t.testBoxId, t.taskKey)]);

// Delivery dates (0146): a box has one or more, added over time; each gets
// its own back-scheduled chain. Soft delete.
export const testBoxDeliveriesTable = pgTable("test_box_deliveries", {
  id: serial("id").primaryKey(),
  testBoxId: integer("test_box_id").notNull().references(() => testBoxesTable.id, { onDelete: "cascade" }),
  deliveryDate: date("delivery_date").notNull(),
  expectedBoxes: integer("expected_boxes"),
  // open | closed | queued | made | delivered | cancelled — orders close by hand
  status: text("status").notNull().default("open"),
  closedAt: timestamp("closed_at"),
  closedById: integer("closed_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  closedByName: text("closed_by_name"),
  // test_only | test_plus_normal | null (not decided)
  productionMix: text("production_mix"),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  updatedById: integer("updated_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedByName: text("updated_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  deletedById: integer("deleted_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  deletedByName: text("deleted_by_name"),
});
export type TestBoxDelivery = typeof testBoxDeliveriesTable.$inferSelect;

// Shopify products the app created for a box's recipes (0147) — so a re-run
// updates them instead of duplicating. The recipe → variant link itself is
// in recipe_shopify_mappings, like every other product.
export const testBoxShopifyProductsTable = pgTable("test_box_shopify_products", {
  id: serial("id").primaryKey(),
  testBoxId: integer("test_box_id").notNull().references(() => testBoxesTable.id, { onDelete: "cascade" }),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "cascade" }),
  shopifyProductId: text("shopify_product_id").notNull(),
  productTitle: text("product_title"),
  templateProductId: text("template_product_id"),
  imagesCopied: boolean("images_copied").notNull().default(true),
  // created (duplicated, details not all written yet) | complete
  state: text("state").notNull().default("created"),
  lastError: text("last_error"),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  updatedByName: text("updated_by_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [unique().on(t.testBoxId, t.recipeId)]);

export type TestBox = typeof testBoxesTable.$inferSelect;
