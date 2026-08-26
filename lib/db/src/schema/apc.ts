/**
 * APC consignment ledger.
 *
 * One row per consignment whose printed label has been scanned onto a Shopify
 * order at the packing bench. This is the record that makes the tracking number
 * auditable rather than a fire-and-forget API call, and — via the UNIQUE
 * constraint on `waybill` — it is the thing that stops the same physical label
 * being scanned onto two different orders. That was the one remaining way the
 * flow could still put the wrong tracking number on a customer's order.
 *
 * Consignments are currently raised by hand in Hypaship (bulk CSV upload) with
 * the Shopify order name as the reference, INCLUDING the leading "#" — verified
 * against live on 2026-07-28. The app looks them up by that reference, then
 * verifies the scanned label barcode belongs to the consignment before writing
 * the waybill to Shopify.
 */
import { pgTable, serial, text, timestamp, integer, bigint, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./users";

export const apcConsignmentsTable = pgTable("apc_consignments", {
  id: serial("id").primaryKey(),
  // 22-digit APC consignment identifier — <8-digit send date><14-digit core>.
  // Always taken from the APC API, never derived from a scanned barcode (the
  // barcode carries only the 14-digit core, with no send date).
  waybill: text("waybill").notNull().unique(),
  // The reference APC holds, e.g. "#131377".
  reference: text("reference"),
  shopifyOrderId: bigint("shopify_order_id", { mode: "number" }),
  shopifyOrderName: text("shopify_order_name"),
  consigneeName: text("consignee_name"),
  consigneePostcode: text("consignee_postcode"),
  // Exactly what the scanner read, kept verbatim for audit.
  scannedBarcode: text("scanned_barcode"),
  trackingUrl: text("tracking_url"),
  verifiedAt: timestamp("verified_at").notNull().defaultNow(),
  verifiedByUserId: integer("verified_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  verifiedByName: text("verified_by_name"),
  // Set once the waybill has actually reached Shopify, so an end-of-dispatch
  // audit can separate "scanned but never pushed" from "fully done".
  pushedToShopifyAt: timestamp("pushed_to_shopify_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  orderIdx: index("ix_apc_consignments_order").on(t.shopifyOrderId),
  verifiedIdx: index("ix_apc_consignments_verified").on(t.verifiedAt),
}));

export type ApcConsignment = typeof apcConsignmentsTable.$inferSelect;

export const insertApcConsignmentSchema = createInsertSchema(apcConsignmentsTable).omit({ id: true, createdAt: true });

/**
 * Operator-corrected delivery address for one order's courier label.
 *
 * APC allows 35 characters per address line. When a Shopify address doesn't
 * fit, the normaliser cuts it — and the cut can land on the part that matters
 * most ("Warren Road North Somercotes, Van 313 The Lawns" loses the van
 * number, so the parcel reaches the park but not the pitch). No amount of
 * parsing fixes that reliably: it needs someone who can look at the order and
 * decide what the driver actually needs.
 *
 * A row here is that decision, recorded. It overrides the normaliser for this
 * order's label ONLY — the Shopify order is deliberately left untouched, so
 * the customer's own record stays as they wrote it and nothing we do here can
 * corrupt the source. One row per order (`shopify_order_id` UNIQUE): the
 * latest correction wins, and re-editing updates in place.
 */
export const apcLabelAddressesTable = pgTable("apc_label_addresses", {
  id: serial("id").primaryKey(),
  shopifyOrderId: bigint("shopify_order_id", { mode: "number" }).notNull().unique(),
  shopifyOrderName: text("shopify_order_name"),
  // Held pre-cut to APC's 35-character lines — what the operator saw is
  // exactly what the label carries.
  address1: text("address1").notNull(),
  address2: text("address2"),
  city: text("city").notNull(),
  postcode: text("postcode").notNull(),
  // Optional extras the operator can move text into rather than lose it: the
  // company line prints above the address, instructions reach the driver.
  companyName: text("company_name"),
  instructions: text("instructions"),
  // What the address looked like before the correction, so an audit can show
  // what was changed and why without re-fetching the order from Shopify.
  originalAddress1: text("original_address1"),
  originalAddress2: text("original_address2"),
  originalCity: text("original_city"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedByUserId: integer("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedByName: text("updated_by_name"),
}, (t) => ({
  orderIdx: index("ix_apc_label_addresses_order").on(t.shopifyOrderId),
}));

export type ApcLabelAddress = typeof apcLabelAddressesTable.$inferSelect;
