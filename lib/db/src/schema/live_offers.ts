/**
 * Live offers (switchable sales offers) and the Lucky Order Number winners
 * log. Created by migration 0325_lucky_order_offer.sql; see that file for
 * the why. Written by api-server lib/lucky-order/engine.ts.
 */
import { pgTable, text, boolean, timestamp, jsonb, bigint, numeric, integer } from "drizzle-orm/pg-core";

export const liveOffersTable = pgTable("live_offers", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  practiceMode: boolean("practice_mode").notNull().default(true),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  settings: jsonb("settings").notNull().default({}),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const luckyOrderWinnersTable = pgTable("lucky_order_winners", {
  orderId: text("order_id").primaryKey(),
  orderName: text("order_name").notNull(),
  orderNumber: bigint("order_number", { mode: "number" }).notNull(),
  tier: text("tier").notNull(),
  practice: boolean("practice").notNull(),
  sourceName: text("source_name"),
  customerId: text("customer_id"),
  customerEmail: text("customer_email"),
  customerName: text("customer_name"),
  orderTotal: numeric("order_total", { precision: 10, scale: 2 }),
  orderCreatedAt: timestamp("order_created_at", { withTimezone: true }).notNull(),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  giftStatus: text("gift_status").notNull(),
  giftTitle: text("gift_title"),
  refundStatus: text("refund_status").notNull(),
  refundAmount: numeric("refund_amount", { precision: 10, scale: 2 }),
  refundDecidedBy: text("refund_decided_by"),
  codeStatus: text("code_status").notNull(),
  discountCode: text("discount_code"),
  emailStatus: text("email_status").notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
