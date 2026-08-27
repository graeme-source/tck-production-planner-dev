/**
 * Eight-pack bag orders queued for a production date whose plan doesn't
 * exist yet.
 *
 * THE PROBLEM (Graeme, 2026-08-27): a customer ordered 8-pack bags for a
 * delivery date three weeks out. Processing an order needs a production plan
 * to put the bags on, plans are only made a couple of days ahead, so the
 * order sat in the dashboard queue for a fortnight with nobody able to do
 * anything about it.
 *
 * This table is the promise in between. Processing such an order tags it in
 * Shopify exactly as it always did — that's what routes despatch — and writes
 * a row here saying "on this production date, N bags of this recipe, for this
 * order". When the plan for that date is finally created, the row lands on it
 * automatically: the bags go onto production_plan_items.eight_pack_bag_count,
 * the same column the +/- buttons on the production overview drive.
 *
 * It deliberately mirrors queued_production (same statuses, same land-on-
 * create, same reset-when-the-plan-is-deleted), so there is one mental model
 * for "work decided before the plan exists" rather than two.
 *
 * RELIABILITY, because this must not fail quietly:
 *   • The queued bags are fed into the Create Plan screen's own bag maths, so
 *     the suggested batches already cover them before anyone clicks save.
 *   • A row only becomes 'planned' once its bags are actually on a plan item.
 *     A row whose recipe didn't make it onto the plan stays 'queued' and keeps
 *     showing up, rather than being marked done and forgotten.
 *   • The bag-cover check (lib/bag-cover.ts) reads these rows, so an unlanded
 *     promise is visible as a risk to a specific despatch, not a silent hole.
 *
 * Status: queued → planned | cancelled.
 */
import { pgTable, serial, integer, date, text, timestamp, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { recipesTable } from "./recipes";
import { productionPlansTable } from "./production_plans";
import { usersTable } from "./users";

export const queuedBagOrdersTable = pgTable("queued_bag_orders", {
  id: serial("id").primaryKey(),
  /** The plan date the bags should be made on. */
  productionDate: date("production_date").notNull(),
  /** The date the customer is expecting delivery — despatch is the day before. */
  deliveryDate: date("delivery_date").notNull(),
  recipeId: integer("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "cascade" }),
  bags: integer("bags").notNull(),
  /** Which Shopify order this came from, so a queued bag is always traceable
   *  back to the customer waiting for it. */
  shopifyOrderId: text("shopify_order_id").notNull(),
  shopifyOrderName: text("shopify_order_name"),
  status: text("status").notNull().default("queued"),
  planId: integer("plan_id").references(() => productionPlansTable.id, { onDelete: "set null" }),
  /** When the bags actually landed on a plan item. */
  landedAt: timestamp("landed_at"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  dateIdx: index("ix_queued_bag_orders_date").on(t.productionDate),
  statusIdx: index("ix_queued_bag_orders_status").on(t.status),
  // Processing the same order twice must not double the bags. The Shopify
  // "production" tag already guards against it; this makes it structural.
  orderRecipeUnique: unique("uq_queued_bag_orders_order_recipe").on(t.shopifyOrderId, t.recipeId, t.productionDate),
}));

export type QueuedBagOrder = typeof queuedBagOrdersTable.$inferSelect;
export const insertQueuedBagOrderSchema = createInsertSchema(queuedBagOrdersTable).omit({ id: true, createdAt: true });
