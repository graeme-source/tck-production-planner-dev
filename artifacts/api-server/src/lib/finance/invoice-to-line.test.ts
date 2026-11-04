import { describe, expect, it } from "vitest";
import { chargesThatAddUp, isConfidentPick, isStrongMatch, isWorthChecking, pickCertainMatches, rankLinesForInvoice, scoreInvoiceAgainstLine, type LineCandidate, type QueuedInvoice } from "./invoice-to-line";

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

describe("pickCertainMatches", () => {
  const invoice = (over: Partial<QueuedInvoice> = {}): QueuedInvoice => ({
    id: 1, supplierName: "Aluxo Limited", invoiceDate: "2026-10-05", invoiceNumber: null, totalAmount: "120.00",
    docKind: "invoice", readStatus: "done", rejectedLineIds: [], ...over,
  });

  it("matches the invoice dropped before its transaction arrived", () => {
    expect(pickCertainMatches([invoice()], [line({ id: 11 })])).toMatchObject([{ invoiceId: 1, lineId: 11 }]);
  });

  it("leaves a monthly charge at the same price for a person", () => {
    expect(pickCertainMatches([invoice()], [line({ id: 10, lineDate: "2026-09-06" }), line({ id: 11 })])).toEqual([]);
  });

  it("leaves two invoices that want the same transaction for a person", () => {
    expect(pickCertainMatches([invoice({ id: 1 }), invoice({ id: 2 })], [line({ id: 11 })])).toEqual([]);
  });

  it("needs the supplier as well as the amount", () => {
    expect(pickCertainMatches([invoice({ supplierName: "Screwfix" })], [line({ id: 11 })])).toEqual([]);
  });

  it("needs the charge within a week of the invoice, unless the reference is on both", () => {
    const late = line({ id: 11, lineDate: "2026-10-20" });
    expect(pickCertainMatches([invoice()], [late])).toEqual([]);
    const referenced = line({ id: 11, lineDate: "2026-10-20", descriptor: "ALUXO INV-1001", orderReference: "INV-1001" });
    expect(pickCertainMatches([invoice({ invoiceNumber: "INV-1001" })], [referenced])).toHaveLength(1);
  });

  it("never matches a receipt or an invoice it couldn't read", () => {
    expect(pickCertainMatches([invoice({ docKind: "receipt" })], [line({ id: 11 })])).toEqual([]);
    expect(pickCertainMatches([invoice({ readStatus: "failed" })], [line({ id: 11 })])).toEqual([]);
  });

  it("never goes back to a transaction someone said it isn't", () => {
    expect(pickCertainMatches([invoice({ rejectedLineIds: [11] })], [line({ id: 11 })])).toEqual([]);
  });
});

describe("a strong match", () => {
  const inv = { supplierName: "Anthropic, PBC", invoiceDate: "2026-11-04", invoiceNumber: "DCT4LIGD-0003", totalAmount: "95.31" };
  const charge = (over: Partial<LineCandidate>) => line({ descriptor: "ANTHROPIC", merchant: "ANTHROPIC", vendorName: "Anthropic", lineDate: "2026-11-03", ...over });

  it("is not claimed for the right supplier at the wrong amount (the Anthropic £150 card)", () => {
    const ranked = rankLinesForInvoice(inv, [charge({ amount: "150.00", lineDate: "2026-10-28" })]);
    expect(ranked).toHaveLength(1);
    expect(isStrongMatch(ranked[0])).toBe(false);
    expect(isConfidentPick(ranked)).toBe(false);
    expect(ranked[0].mismatches).toEqual(["Amount is £54.69 more than the invoice"]);
  });

  it("is claimed when the amount, supplier and date all agree", () => {
    const ranked = rankLinesForInvoice(inv, [charge({ amount: "95.31" })]);
    expect(isStrongMatch(ranked[0])).toBe(true);
    expect(isConfidentPick(ranked)).toBe(true);
    expect(ranked[0].mismatches).toEqual([]);
    expect(ranked[0].doubts).toEqual([]);
  });

  it("is not claimed when the date is far off, and says so", () => {
    const ranked = rankLinesForInvoice(inv, [charge({ amount: "95.31", lineDate: "2026-10-10" })]);
    expect(isConfidentPick(ranked)).toBe(false);
    expect(ranked[0].doubts).toContain("charged 25 days before the invoice date");
  });

  it("names the supplier problem even when the amount agrees", () => {
    const s = scoreInvoiceAgainstLine(
      { ...inv, invoiceNumber: null, totalAmount: "150.00" },
      line({ amount: "150.00", descriptor: "ADOBE", merchant: "ADOBE", vendorName: "Adobe", lineDate: "2026-11-03" }),
    );
    expect(s?.mismatches).toEqual(["Supplier is different: invoice says Anthropic, PBC, transaction says Adobe"]);
  });

  it("flags a total that wasn't read rather than staying quiet", () => {
    const [s] = rankLinesForInvoice({ ...inv, totalAmount: null }, [charge({ amount: "150.00" })]);
    expect(s.mismatches).toEqual(["Invoice total wasn't read"]);
  });

  it("puts the same amount ahead of a closer date at the wrong amount", () => {
    const ranked = rankLinesForInvoice(inv, [
      charge({ id: 1, amount: "150.00", lineDate: "2026-11-04" }),
      charge({ id: 2, amount: "95.31", lineDate: "2026-10-20" }),
    ]);
    expect(ranked[0].lineId).toBe(2);
  });
});

describe("chargesThatAddUp", () => {
  const inv = { supplierName: "Google", invoiceDate: "2026-11-01", invoiceNumber: null, totalAmount: "500.00" };
  const charge = (id: number, amount: string, over: Partial<LineCandidate> = {}) =>
    line({ id, amount, descriptor: "GOOGLE ADS", merchant: "GOOGLE", vendorName: "Google", lineDate: "2026-10-20", ...over });

  it("finds the supplier's charges that make up the invoice", () => {
    const ids = chargesThatAddUp(inv, [charge(1, "200.00"), charge(2, "175.50"), charge(3, "124.50"), charge(4, "60.00")]);
    expect(ids?.sort()).toEqual([1, 2, 3]);
  });

  it("doesn't count another supplier's charge", () => {
    expect(chargesThatAddUp(inv, [charge(1, "250.00"), charge(2, "250.00", { descriptor: "ALUXO", merchant: "ALUXO", vendorName: "Aluxo" })])).toBeNull();
  });

  it("uses each charge once and needs more than one", () => {
    expect(chargesThatAddUp(inv, [charge(1, "250.00")])).toBeNull();
    expect(chargesThatAddUp(inv, [charge(1, "500.00")])).toBeNull();
  });

  it("ignores refunds and an invoice with no total", () => {
    expect(chargesThatAddUp(inv, [charge(1, "600.00"), charge(2, "-100.00")])).toBeNull();
    expect(chargesThatAddUp({ ...inv, totalAmount: null }, [charge(1, "250.00"), charge(2, "250.00")])).toBeNull();
  });

  it("handles pennies exactly", () => {
    expect(chargesThatAddUp({ ...inv, totalAmount: "0.30" }, [charge(1, "0.10"), charge(2, "0.20")])?.sort()).toEqual([1, 2]);
  });
});

describe("what's worth someone's time", () => {
  const inv = { supplierName: "Amazon Business EU", invoiceDate: "2026-09-15", invoiceNumber: "GB68ER0DABEI", totalAmount: "63.11" };
  const charge = (id: number, amount: string, lineDate: string, cardLast4: string) =>
    line({ id, amount, lineDate, cardLast4, descriptor: "AMAZON", merchant: "AMAZON", vendorName: "Amazon Marketplace" });

  it("no longer adds up unrelated charges (the Amazon £63.11 card)", () => {
    expect(chargesThatAddUp(inv, [
      charge(1, "13.28", "2026-10-02", "7859"), charge(2, "8.99", "2026-10-13", "3465"), charge(3, "8.99", "2026-10-20", "3465"),
      charge(4, "11.58", "2026-10-23", "7859"), charge(5, "6.99", "2026-10-27", "7859"), charge(6, "13.28", "2026-10-27", "7859"),
    ])).toBeNull();
  });

  it("won't mix cards, even on the right dates", () => {
    expect(chargesThatAddUp({ ...inv, totalAmount: "20.00" }, [charge(1, "10.00", "2026-09-10", "7859"), charge(2, "10.00", "2026-09-12", "3465")])).toBeNull();
  });

  it("still adds up charges on one card before the invoice", () => {
    expect(chargesThatAddUp({ ...inv, totalAmount: "20.00" }, [charge(1, "10.00", "2026-09-01", "3465"), charge(2, "10.00", "2026-09-12", "3465")])?.sort()).toEqual([1, 2]);
  });

  it("leaves the same amount a month later out of the check list", () => {
    const later = scoreInvoiceAgainstLine({ ...inv, invoiceNumber: null, totalAmount: "11.58", invoiceDate: "2026-09-23" }, charge(1, "11.58", "2026-10-23", "7859"));
    expect(isWorthChecking(later!)).toBe(false);
    const close = scoreInvoiceAgainstLine({ ...inv, invoiceNumber: null, totalAmount: "11.58", invoiceDate: "2026-10-15" }, charge(1, "11.58", "2026-10-23", "7859"));
    expect(isWorthChecking(close!)).toBe(true);
  });

  it("leaves a matching amount from another supplier out", () => {
    const s = scoreInvoiceAgainstLine({ ...inv, invoiceNumber: null, totalAmount: "11.58", invoiceDate: "2026-10-22" }, line({ amount: "11.58", lineDate: "2026-10-23" }));
    expect(s && isWorthChecking(s)).toBe(false);
  });
});
