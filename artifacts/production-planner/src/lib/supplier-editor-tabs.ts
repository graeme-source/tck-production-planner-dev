/**
 * The tabs of the supplier editor (Graeme, 11 Nov 2026: "give the same
 * treatment to the supplier edit screen … full screen and put it into
 * sections, so it's easier to navigate and find the settings"). Same pattern
 * as lib/ingredient-editor-tabs. Objective C. Pure — tested alongside.
 *
 *   • SUPPLIER_TABS — the bar, in order. Payment terms and goods-in checks
 *     save against an existing supplier, so a new one doesn't get those tabs.
 *   • SUPPLIER_FIELD_TABS — which tab each form field lives on, so a refused
 *     save opens the tab with the first problem and each tab shows its count.
 */

export type SupplierTabId = "contact" | "ordering" | "account" | "checks";

export const SUPPLIER_TABS: ReadonlyArray<{ id: SupplierTabId; label: string; hint: string; existingOnly?: boolean }> = [
  { id: "contact", label: "Contact", hint: "Name, phone, email, address" },
  { id: "ordering", label: "Ordering", hint: "Days, cut-off, minimum order" },
  { id: "account", label: "Account & payment", hint: "Account manager, terms, invoices" },
  { id: "checks", label: "Goods-in checks", hint: "Checks on each delivery", existingOnly: true },
];

/** The tabs to show: all of them for an existing supplier, no save-later tabs for a new one. */
export function supplierTabsFor(isExisting: boolean): SupplierTabId[] {
  return SUPPLIER_TABS.filter(t => isExisting || !t.existingOnly).map(t => t.id);
}

export const SUPPLIER_FIELD_TABS: Readonly<Record<string, SupplierTabId>> = {
  name: "contact", contactName: "contact", phone: "contact", email: "contact", orderingPhone: "contact",
  website: "contact", address: "contact", notes: "contact",
  orderFrequency: "ordering", orderDays: "ordering", leadTimeDays: "ordering", cutoffTime: "ordering",
  minimumOrderValue: "ordering", orderByEmail: "ordering",
  accountManagerName: "account", accountManagerEmail: "account", accountNumber: "account", invoiceNotRequired: "account",
};

/** Problems per tab, from react-hook-form's errors. An unknown field counts on Contact, so it's never hidden. */
export function supplierErrorCounts(errors: Record<string, unknown> | null | undefined): Partial<Record<SupplierTabId, number>> {
  const out: Partial<Record<SupplierTabId, number>> = {};
  for (const [field, e] of Object.entries(errors ?? {})) {
    if (!e) continue;
    const tab = SUPPLIER_FIELD_TABS[field] ?? "contact";
    out[tab] = (out[tab] ?? 0) + 1;
  }
  return out;
}

/** The first tab, in bar order, with a problem — or null. */
export function firstSupplierErrorTab(errors: Record<string, unknown> | null | undefined): SupplierTabId | null {
  const counts = supplierErrorCounts(errors);
  return SUPPLIER_TABS.find(t => (counts[t.id] ?? 0) > 0)?.id ?? null;
}
