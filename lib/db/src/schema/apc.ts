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
