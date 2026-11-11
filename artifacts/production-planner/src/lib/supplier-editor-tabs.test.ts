import { describe, expect, it } from "vitest";
import { SUPPLIER_FIELD_TABS, SUPPLIER_TABS, firstSupplierErrorTab, supplierErrorCounts, supplierTabsFor } from "./supplier-editor-tabs";

describe("supplier editor tabs", () => {
  it("a new supplier has no goods-in checks tab (they save against an existing one)", () => {
    expect(supplierTabsFor(false)).toEqual(["contact", "ordering", "account"]);
    expect(supplierTabsFor(true)).toEqual(["contact", "ordering", "account", "checks"]);
  });

  it("the minimum order value is on the Ordering tab, where people look for it", () => {
    expect(SUPPLIER_FIELD_TABS.minimumOrderValue).toBe("ordering");
  });

  it("every tab in the field map is a real tab", () => {
    const ids = new Set(SUPPLIER_TABS.map(t => t.id));
    for (const tab of Object.values(SUPPLIER_FIELD_TABS)) expect(ids.has(tab)).toBe(true);
  });

  it("a refused save opens the first tab with a problem, and counts per tab", () => {
    const errors = { minimumOrderValue: { message: "x" }, accountManagerEmail: { message: "y" } };
    expect(firstSupplierErrorTab(errors)).toBe("ordering");
    expect(supplierErrorCounts(errors)).toEqual({ ordering: 1, account: 1 });
    expect(firstSupplierErrorTab({ name: { message: "Name is required" } })).toBe("contact");
    expect(firstSupplierErrorTab({})).toBeNull();
    expect(supplierErrorCounts({ mystery: {} })).toEqual({ contact: 1 });
  });
});
