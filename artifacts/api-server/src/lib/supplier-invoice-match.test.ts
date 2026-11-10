import { describe, expect, it } from "vitest";
import { matchSupplierForInvoice, nameWords, type SupplierForMatch } from "./supplier-invoice-match";

// Live suppliers and the names their invoices really carry (10 Nov 2026).
const suppliers: SupplierForMatch[] = [
  { id: 1, name: "Brakes Food Service", paymentTerms: "on_account", invoiceNames: ["Sysco GB Ltd (Brakes)"] },
  { id: 2, name: "Express Food Service", paymentTerms: "paid_when_ordered", invoiceNames: [] },
  { id: 3, name: "The Best Butcher", paymentTerms: "on_account", invoiceNames: [] },
  { id: 26, name: "NFS Meats", paymentTerms: "on_account", invoiceNames: ["Northamptonshire Food Services Ltd"] },
  { id: 27, name: "Macfarlane Packaging", paymentTerms: "on_account", invoiceNames: ["Macfarlane Group UK Limited"] },
  { id: 31, name: "Puffin Packaging", paymentTerms: "on_account", invoiceNames: [] },
  { id: 36, name: "Panibois ", paymentTerms: "on_account", invoiceNames: [] },
  { id: 43, name: "APC", paymentTerms: "on_account", invoiceNames: [] },
  { id: 17, name: "TCK", paymentTerms: "paid_when_ordered", invoiceNames: [] },
];
const id = (name: string) => matchSupplierForInvoice(name, suppliers)?.supplierId ?? null;

describe("matchSupplierForInvoice", () => {
  it("uses a linked invoice name: Northamptonshire Food Services is NFS Meats", () => {
    expect(matchSupplierForInvoice("Northamptonshire Food Services Ltd", suppliers))
      .toEqual({ supplierId: 26, supplierName: "NFS Meats", paymentTerms: "on_account" });
    expect(id("NORTHAMPTONSHIRE FOOD SERVICES LTD.")).toBe(26);
  });

  it("matches the names already on the invoices in the library", () => {
    expect(id("T.H.E. Best Butchers Ltd")).toBe(3);
    expect(id("Sysco GB Ltd (Brakes)")).toBe(1);
    expect(id("Macfarlane Packaging (Macfarlane Group UK Limited)")).toBe(27);
    expect(id("Macfarlane Group UK Limited")).toBe(27);
    expect(id("Puffin Packaging Limited")).toBe(31);
    expect(id("PANIBOIS")).toBe(36);
    expect(id("APC Overnight")).toBe(43);
  });

  it("needs every word of the supplier's name", () => {
    expect(id("Express Foodservice Ltd")).toBeNull();
    expect(id("Food Service Supplies")).toBeNull();
  });

  it("finds nothing for unknown or unread names", () => {
    expect(id("Bristol Plastic Containers")).toBeNull();
    expect(matchSupplierForInvoice(null, suppliers)).toBeNull();
    expect(matchSupplierForInvoice("  ", suppliers)).toBeNull();
  });
});

describe("nameWords", () => {
  it("drops company endings and treats plurals as the same word", () => {
    expect(nameWords("T.H.E. Best Butchers Ltd")).toEqual(["best", "butcher"]);
    expect(nameWords("Macfarlane Group UK Limited")).toEqual(["macfarlane", "group"]);
  });
});
