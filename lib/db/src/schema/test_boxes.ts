import { pgTable, serial, text, integer, timestamp, date, boolean, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { recipesTable } from "./recipes";

// Test-box scheduling tool (migration 0136). Deadlines are computed on read
// from the delivery date + supplier lead times — see
// api-server/src/lib/test-box-schedule.ts — never stored.
export const testBoxesTable = pgTable("test_boxes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  deliveryDate: date("delivery_date").notNull(),
  // vip | vip_then_public | public
  audience: text("audience").notNull().default("vip_then_public"),
  // planning | selling | ordering | producing | delivered | cancelled
  status: text("status").notNull().default("planning"),
  notes: text("notes"),
  bufferPct: integer("buffer_pct").notNull().default(25),
  bufferDays: integer("buffer_days").notNull().default(2),
  sellingDays: integer("selling_days").notNull().default(14),
  ordersCloseDays: integer("orders_close_days").notNull().default(2),
  vipHeadStartDays: integer("vip_head_start_days").notNull().default(3),
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
}, (t) => [unique().on(t.testBoxId, t.taskKey)]);

export type TestBox = typeof testBoxesTable.$inferSelect;
