/**
 * Sales drivers — the website changelog and the daily facts that plausibly
 * move sales (delivery lead time, sessions, conversion). Created by
 * migration 0089_sales_drivers.sql; see that file for the why.
 */
import { pgTable, serial, text, integer, boolean, timestamp, date, numeric } from "drizzle-orm/pg-core";

export const siteChangesTable = pgTable("site_changes", {
  id: serial("id").primaryKey(),
  // When the change went live — not when it was logged.
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
  category: text("category").notNull().default("other"),
  title: text("title").notNull(),
  detail: text("detail"),
  // manual | theme | klaviyo | shopify
  source: text("source").notNull().default("manual"),
  // De-duplicates automatic imports (commit sha, campaign id…).
  sourceRef: text("source_ref"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deliveryAvailabilityDailyTable = pgTable("delivery_availability_daily", {
  day: date("day").primaryKey(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  earliestDate: date("earliest_date"),
  leadDays: integer("lead_days"),
  nextDayAvailable: boolean("next_day_available"),
  // zapiet_1pm (exact) | orders_estimate (back-filled, approximate)
  source: text("source").notNull(),
  sampleOrders: integer("sample_orders"),
  note: text("note"),
});

export const storeDailyMetricsTable = pgTable("store_daily_metrics", {
  day: date("day").primaryKey(),
  sessions: integer("sessions"),
  conversionRate: numeric("conversion_rate", { precision: 8, scale: 4 }),
  orders: integer("orders"),
  newCustomerOrders: integer("new_customer_orders"),
  revenue: numeric("revenue", { precision: 12, scale: 2 }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});
