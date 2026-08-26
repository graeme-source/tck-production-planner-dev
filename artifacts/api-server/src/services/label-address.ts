/**
 * Operator-corrected delivery addresses for APC labels.
 *
 * Why this exists: APC's 35-character lines mean some Shopify addresses cannot
 * be sent whole, and the automatic cut sometimes removes the part that finds
 * the door. Rather than guess harder, the app lets whoever is booking the
 * labels re-cut the address themselves and records that decision here.
 *
 * Two deliberate constraints:
 *   - The override applies to the LABEL only. The Shopify order is never
 *     written to, so a correction can never corrupt the customer's own record
 *     and a wrong one is undone by deleting a row.
 *   - Lines are stored already cut to fit. What the operator approved on
 *     screen is byte-for-byte what APC receives (see `addressAlreadyFitted`
 *     in services/apc.ts), so nothing silently reshapes it afterwards.
 */
import { db, apcLabelAddressesTable, type ApcLabelAddress } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { ADDRESS_LINE_MAX } from "./apc";

export interface LabelAddressInput {
  shopifyOrderId: number;
  shopifyOrderName?: string;
  address1: string;
  address2?: string;
  city: string;
  postcode: string;
  companyName?: string;
  instructions?: string;
  originalAddress1?: string;
  originalAddress2?: string;
  originalCity?: string;
  updatedByUserId?: number;
  updatedByName?: string;
}

const trim = (s: string | undefined | null): string | null => {
  const v = (s ?? "").replace(/\s+/g, " ").trim();
  return v === "" ? null : v;
};

/** Cut to APC's line limit as a last defence. The screen enforces the same
 *  limit live, so this should never bite — but a label is not the place to
 *  find out that a client-side check was bypassed. */
const fit = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, ADDRESS_LINE_MAX);

/** Every override for a set of orders, keyed by order id. Batched because the
 *  preflight builds a whole dispatch day at once — one query, not one per
 *  order in a wave of several hundred. */
export async function getLabelAddressesFor(
  orderIds: number[],
): Promise<Map<number, ApcLabelAddress>> {
  if (orderIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(apcLabelAddressesTable)
    .where(inArray(apcLabelAddressesTable.shopifyOrderId, orderIds));
  return new Map(rows.map(r => [r.shopifyOrderId, r]));
}

export async function getLabelAddress(orderId: number): Promise<ApcLabelAddress | null> {
  const [row] = await db
    .select()
    .from(apcLabelAddressesTable)
    .where(eq(apcLabelAddressesTable.shopifyOrderId, orderId))
    .limit(1);
  return row ?? null;
}

/** Save (or replace) the correction for one order. Upsert on the order id so
 *  re-editing the same order updates in place rather than accumulating rows
 *  whose precedence would then be ambiguous. */
export async function saveLabelAddress(input: LabelAddressInput): Promise<ApcLabelAddress> {
  const values = {
    shopifyOrderId: input.shopifyOrderId,
    shopifyOrderName: trim(input.shopifyOrderName),
    address1: fit(input.address1),
    address2: trim(input.address2) ? fit(input.address2!) : null,
    city: fit(input.city),
    postcode: trim(input.postcode) ?? "",
    companyName: trim(input.companyName) ? fit(input.companyName!) : null,
    // APC caps Instructions at 50 characters, not 35 — it is a free-text
    // field on the consignment rather than an address line.
    instructions: trim(input.instructions)?.slice(0, 50) ?? null,
    originalAddress1: trim(input.originalAddress1),
    originalAddress2: trim(input.originalAddress2),
    originalCity: trim(input.originalCity),
    updatedAt: new Date(),
    updatedByUserId: input.updatedByUserId ?? null,
    updatedByName: trim(input.updatedByName),
  };

  const [row] = await db
    .insert(apcLabelAddressesTable)
    .values(values)
    .onConflictDoUpdate({
      target: apcLabelAddressesTable.shopifyOrderId,
      set: {
        shopifyOrderName: values.shopifyOrderName,
        address1: values.address1,
        address2: values.address2,
        city: values.city,
        postcode: values.postcode,
        companyName: values.companyName,
        instructions: values.instructions,
        originalAddress1: values.originalAddress1,
        originalAddress2: values.originalAddress2,
        originalCity: values.originalCity,
        updatedAt: values.updatedAt,
        updatedByUserId: values.updatedByUserId,
        updatedByName: values.updatedByName,
      },
    })
    .returning();
  return row!;
}

/** Drop the correction and fall back to the automatic address. The undo for a
 *  correction someone regrets — no row means no override. */
export async function deleteLabelAddress(orderId: number): Promise<boolean> {
  const deleted = await db
    .delete(apcLabelAddressesTable)
    .where(eq(apcLabelAddressesTable.shopifyOrderId, orderId))
    .returning();
  return deleted.length > 0;
}
