import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  extractInvoiceFiles, invoiceMimeFor, supplierHintFromPath, financialYearOfDate, financialYearRange,
  periodOf, periodRange, normaliseInvoiceReading, invoiceDuplicateKey, normaliseSupplierForMatch,
} from "./invoice-library";

const pdf = strToU8("%PDF-1.4 fake");

describe("extractInvoiceFiles", () => {
  it("keeps PDFs and photos, skips other files and Mac clutter", () => {
    const zip = zipSync({
      "Aluxo/INV-1.pdf": pdf,
      "Aluxo/photo.JPG": strToU8("jpeg"),
      "notes.txt": strToU8("hi"),
      "__MACOSX/Aluxo/._INV-1.pdf": strToU8("x"),
      ".DS_Store": strToU8("x"),
      "empty.pdf": new Uint8Array(0),
    });
    const { files, skipped } = extractInvoiceFiles(zip);
    expect(files.map((f) => [f.path, f.mime])).toEqual([
      ["Aluxo/INV-1.pdf", "application/pdf"],
      ["Aluxo/photo.JPG", "image/jpeg"],
    ]);
    expect(skipped).toEqual(["notes.txt (not a PDF or photo)", "empty.pdf (empty file)"]);
    expect(files[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("opens zips inside the zip", () => {
    const inner = zipSync({ "march.pdf": pdf });
    const { files } = extractInvoiceFiles(zipSync({ "2026/March.zip": inner }));
    expect(files.map((f) => f.path)).toEqual(["2026/March.zip/march.pdf"]);
  });

  it("says so when it isn't a zip", () => {
    expect(extractInvoiceFiles(strToU8("nope")).skipped[0]).toMatch(/couldn't be opened/);
  });
});

describe("invoiceMimeFor / supplierHintFromPath", () => {
  it("knows invoice file types", () => {
    expect(invoiceMimeFor("a.PDF")).toBe("application/pdf");
    expect(invoiceMimeFor("a.heic")).toBe("image/heic");
    expect(invoiceMimeFor("a.docx")).toBeNull();
  });
  it("takes the nearest meaningful folder as the supplier", () => {
    expect(supplierHintFromPath("Aluxo/2026/INV-1.pdf")).toBe("Aluxo");
    expect(supplierHintFromPath("Invoices/Screwfix/March/x.pdf")).toBe("Screwfix");
    expect(supplierHintFromPath("x.pdf")).toBeNull();
    expect(supplierHintFromPath("Invoices/2025-26/x.pdf")).toBeNull();
  });
});

describe("financial year and periods (April → March)", () => {
  it("puts dates in the right year", () => {
    expect(financialYearOfDate("2026-03-31")).toBe("2025/26");
    expect(financialYearOfDate("2026-04-01")).toBe("2026/27");
    expect(financialYearRange("2025/26")).toEqual({ from: "2025-04-01", to: "2026-03-31" });
  });
  it("numbers periods from April", () => {
    expect(periodOf("2026-04-15")).toBe(1);
    expect(periodOf("2026-12-01")).toBe(9);
    expect(periodOf("2027-03-31")).toBe(12);
    expect(periodRange("2025/26", 1)).toEqual({ from: "2025-04-01", to: "2025-04-30" });
    expect(periodRange("2025/26", 11)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("2027/28", 11)).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});

describe("normaliseInvoiceReading", () => {
  it("cleans Claude's answer", () => {
    expect(normaliseInvoiceReading({
      supplier_name: " Aluxo Ltd ", invoice_date: "2026-08-18", invoice_number: "ALX-2214",
      total_amount: "£1,079.49", vat_amount: 13.25, currency: "gbp", doc_kind: "invoice",
    })).toEqual({
      supplierName: "Aluxo Ltd", invoiceDate: "2026-08-18", invoiceNumber: "ALX-2214",
      totalAmount: "1079.49", vatAmount: "13.25", currency: "GBP", docKind: "invoice",
    });
  });
  it("turns unreadable values into nulls, never junk", () => {
    const r = normaliseInvoiceReading({ invoice_date: "18/08/2026", total_amount: "lots", doc_kind: "menu", currency: "pounds" });
    expect(r).toMatchObject({ invoiceDate: null, totalAmount: null, docKind: "invoice", currency: "GBP", supplierName: null });
  });
});

describe("same invoice as a different file", () => {
  const base = { supplierName: "Aluxo Ltd.", invoiceNumber: "INV-002214", invoiceDate: "2026-08-18", totalAmount: "79.49" };
  it("matches on supplier + invoice number, whatever the formatting", () => {
    expect(invoiceDuplicateKey(base)).toBe(invoiceDuplicateKey({ ...base, supplierName: "ALUXO LIMITED", invoiceNumber: "inv 2214", totalAmount: "80.00" }));
    expect(invoiceDuplicateKey(base)).not.toBe(invoiceDuplicateKey({ ...base, invoiceNumber: "INV-2215" }));
    expect(invoiceDuplicateKey(base)).not.toBe(invoiceDuplicateKey({ ...base, supplierName: "Screwfix" }));
  });
  it("falls back to supplier + date + total when there's no number", () => {
    const a = { ...base, invoiceNumber: null };
    expect(invoiceDuplicateKey(a)).toBe("aluxo|2026-08-18|79.49");
    expect(invoiceDuplicateKey({ ...a, totalAmount: "79.50" })).not.toBe(invoiceDuplicateKey(a));
  });
  it("won't guess without a supplier or enough detail", () => {
    expect(invoiceDuplicateKey({ ...base, supplierName: null })).toBeNull();
    expect(invoiceDuplicateKey({ supplierName: "Aluxo", invoiceNumber: null, invoiceDate: null, totalAmount: "1.00" })).toBeNull();
    expect(normaliseSupplierForMatch("The Range & Co")).toBe("range and");
  });
});
