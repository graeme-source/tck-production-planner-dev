// A supplier's default category put to use (Graeme, 26 Nov 2026: "No Fli is
// always used in subscriptions, so it automatically sets that category for
// us … also, when we upload invoices before we have an outstanding
// transaction, it should predefine the category"). Only ever fills a blank:
// a category someone chose is never changed. Categories that mean "no VAT
// invoice" (DLA) can't be defaults — choosing one does more than label it.
// Objective I.
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logFinEvent } from "./invoice-store";
import { vendorDefaultFor, type VendorDefault } from "./vendor-default-category-rules";

/** Outstanding transactions with no category take their supplier's default. */
export async function applyVendorDefaultCategories(vendorId?: number): Promise<number> {
  const rows = await db.execute<{ id: number; category_id: number }>(sql`
    UPDATE fin_lines l SET category_id = v.default_category_id, updated_at = NOW()
      FROM fin_vendors v JOIN fin_categories c ON c.id = v.default_category_id
     WHERE l.vendor_id = v.id AND l.category_id IS NULL AND c.no_vat_reason IS NULL AND c.archived_at IS NULL
       AND l.status IN ('open', 'identified', 'matched')
       ${vendorId != null ? sql`AND v.id = ${vendorId}` : sql``}
    RETURNING l.id, l.category_id
  `);
  for (const r of rows.rows ?? []) await logFinEvent("line", Number(r.id), "category_from_supplier", null, { to: Number(r.category_id) });
  return rows.rows?.length ?? 0;
}

export async function loadVendorDefaults(): Promise<VendorDefault[]> {
  const rows = await db.execute<{ id: number; name: string; default_category_id: number }>(sql`
    SELECT v.id, v.name, v.default_category_id FROM fin_vendors v JOIN fin_categories c ON c.id = v.default_category_id
     WHERE c.no_vat_reason IS NULL AND c.archived_at IS NULL
  `);
  return (rows.rows ?? []).map((r) => ({ vendorId: Number(r.id), name: r.name, defaultCategoryId: Number(r.default_category_id) }));
}

/** A read invoice with no category takes its supplier's default. */
export async function applyVendorDefaultToInvoice(invoiceId: number, supplierName: string | null | undefined): Promise<void> {
  const pick = vendorDefaultFor(supplierName, await loadVendorDefaults());
  if (!pick) return;
  const done = await db.execute<{ id: number }>(sql`
    UPDATE fin_invoices SET category_id = ${pick.defaultCategoryId}, updated_at = NOW()
     WHERE id = ${invoiceId} AND category_id IS NULL RETURNING id
  `);
  if ((done.rows ?? []).length > 0) await logFinEvent("invoice", invoiceId, "category_from_supplier", null, { to: pick.defaultCategoryId, supplier: pick.name });
}
