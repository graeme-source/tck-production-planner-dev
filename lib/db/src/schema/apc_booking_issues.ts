import { pgTable, serial, text, integer, bigint, boolean, date, jsonb, timestamp, unique, index } from "drizzle-orm/pg-core";

// Today's failed APC bookings, kept so the issues report can be reopened
// without booking again (migration 0152). Rules in
// api-server/src/lib/apc-booking-issues.ts. Rows are never deleted — the
// screen filters to the current London day.
export const apcBookingIssuesTable = pgTable("apc_booking_issues", {
  id: serial("id").primaryKey(),
  reportDate: date("report_date").notNull(),
  dispatchTag: text("dispatch_tag").notNull(),
  shopifyOrderId: bigint("shopify_order_id", { mode: "number" }).notNull(),
  orderName: text("order_name").notNull(),
  adminUrl: text("admin_url"),
  customerName: text("customer_name"),
  customerFirstName: text("customer_first_name"),
  customerEmail: text("customer_email"),
  postcode: text("postcode"),
  reason: text("reason"),
  usedServiceCode: text("used_service_code"),
  suggestedRetryCode: text("suggested_retry_code"),
  saturdayAttempt: boolean("saturday_attempt").notNull().default(false),
  refusedNoService: boolean("refused_no_service").notNull().default(false),
  dataFixable: boolean("data_fixable").notNull().default(false),
  postcodeService: jsonb("postcode_service"),
  postcodeCheck: text("postcode_check"),
  /** cant_deliver | saturday_permanent | saturday_temporary | other */
  scenario: text("scenario").notNull().default("other"),
  attempts: integer("attempts").notNull().default(1),
  firstFailedAt: timestamp("first_failed_at", { withTimezone: true }).notNull().defaultNow(),
  lastFailedAt: timestamp("last_failed_at", { withTimezone: true }).notNull().defaultNow(),
  firstFailedBy: text("first_failed_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedNote: text("resolved_note"),
  dealtWithAt: timestamp("dealt_with_at", { withTimezone: true }),
  dealtWithBy: text("dealt_with_by"),
  /** Append-only: [{ kind, at, byUserId, byName, detail }] */
  actions: jsonb("actions").notNull().default([]),
}, (t) => [
  unique("apc_booking_issues_report_date_shopify_order_id_key").on(t.reportDate, t.shopifyOrderId),
  index("idx_apc_booking_issues_day").on(t.reportDate, t.firstFailedAt, t.id),
]);

export type ApcBookingIssue = typeof apcBookingIssuesTable.$inferSelect;
