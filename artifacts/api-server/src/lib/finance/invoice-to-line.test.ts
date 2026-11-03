import { describe, expect, it } from "vitest";
import { isConfidentPick, rankLinesForInvoice, scoreInvoiceAgainstLine, type LineCandidate } from "./invoice-to-line";

const line = (over: Partial<LineCandidate>): LineCandidate => ({
  id: 1, lineDate: "2026-10-06", authDate: null, descriptor: "SP ALUXO LTD", merchant: "ALUXO",
  vendorName: "Aluxo", amount: "120.00", originalAmount: null, orderReference: null, ...over,
});

describe("rankLinesForInvoice", () => {
  it("picks the month the invoice belongs to when a supplier charges the same twice", () => {
    const inv = { supplierName: "Aluxo Limited", invoiceDate: "2026-10-05", invoiceNumber: "INV-1001", totalAmount: "120.00" };
    const ranked = rankLinesForInvoice(inv, [
      line({ id: 10, lineDate: "2026-09-06" }),
      line({ id: 11, lineDate: "2026-10-06" }),
      line({ id: 12, lineDate: "2026-11-05" }),
    ]);
    expect(ranked[0].lineId).toBe(11);
    expect(isConfidentPick(ranked)).toBe(true);
  });

  it("matches the supplier through the card descriptor when there's no vendor", () => {
    const inv = { supplierName: "Bidfood UK Ltd", invoiceDate: "2026-10-01", invoiceNumber: null, totalAmount: "88.40" };
    const s = scoreInvoiceAgainstLine(inv, line({ descriptor: "BIDFOOD 4471 SLOUGH", merchant: null, vendorName: null, amount: "88.40", lineDate: "2026-10-02" }));
    expect(s?.signals).toBe(3);
  });

  it("matches a foreign-currency invoice on the original amount", () => {
    const inv = { supplierName: "Starlink", invoiceDate: "2026-10-10", invoiceNumber: null, totalAmount: "75.00" };
    const s = scoreInvoiceAgainstLine(inv, line({ descriptor: "STARLINK", merchant: "Starlink", vendorName: null, amount: "57.12", originalAmount: "75.00", lineDate: "2026-10-10" }));
    expect(s?.reasons[0]).toMatch(/same amount/);
  });

  it("never suggests a line on the date alone", () => {
    const inv = { supplierName: "Screwfix", invoiceDate: "2026-10-05", invoiceNumber: null, totalAmount: "19.99" };
    expect(scoreInvoiceAgainstLine(inv, line({ lineDate: "2026-10-05" }))).toBeNull();
  });

  it("drops charges more than six weeks from the invoice", () => {
    const inv = { supplierName: "Aluxo", invoiceDate: "2026-06-01", invoiceNumber: null, totalAmount: "120.00" };
    expect(scoreInvoiceAgainstLine(inv, line({ lineDate: "2026-10-06" }))).toBeNull();
  });

  it("is not confident when two charges tie exactly", () => {
    const inv = { supplierName: "Aluxo", invoiceDate: null, invoiceNumber: null, totalAmount: "120.00" };
    const ranked = rankLinesForInvoice(inv, [line({ id: 1 }), line({ id: 2 })]);
    expect(ranked).toHaveLength(2);
    expect(isConfidentPick(ranked)).toBe(false);
  });

  it("uses the order reference saved on the line", () => {
    const inv = { supplierName: "Some Shop", invoiceDate: "2026-10-05", invoiceNumber: "ORD-558812", totalAmount: "40.00" };
    const s = scoreInvoiceAgainstLine(inv, line({ descriptor: "PAYPAL *SOMESHOP", merchant: null, vendorName: null, amount: "41.00", orderReference: "ORD-558812" }));
    expect(s?.reasons.some((r) => r.includes("ORD-558812"))).toBe(true);
  });
});
