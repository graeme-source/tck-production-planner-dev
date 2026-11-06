import { describe, expect, it } from "vitest";
import { inboxEntries, inboxTotal, matchesInboxSearch } from "./finance-inbox";

const invoice = (over: Partial<Parameters<typeof matchesInboxSearch>[0]> = {}) => ({
  supplierName: "Toolstation", invoiceNumber: "INV-42", fileName: "receipt.pdf", notes: null, totalAmount: "120.00", ...over,
});

describe("Inbox", () => {
  it("puts invoices with a likely transaction first", () => {
    expect(inboxEntries({ check: ["a"], waiting: ["b", "c"] })).toEqual(["a", "b", "c"]);
    expect(inboxEntries(undefined)).toEqual([]);
  });

  it("adds up in pounds, converting dollars at the invoice's rate", () => {
    const total = inboxTotal([
      { invoice: invoice({ totalAmount: "100.00", gbpRate: null }) },
      { invoice: invoice({ totalAmount: "100.00", gbpRate: 0.8 }) },
      { invoice: invoice({ totalAmount: null }) },
    ]);
    expect(total).toBeCloseTo(180);
  });

  it("finds an invoice by supplier, number, file, note or amount", () => {
    expect(matchesInboxSearch(invoice(), "  tool ")).toBe(true);
    expect(matchesInboxSearch(invoice(), "inv-42")).toBe(true);
    expect(matchesInboxSearch(invoice(), "receipt")).toBe(true);
    expect(matchesInboxSearch(invoice({ notes: "van repair" }), "van")).toBe(true);
    expect(matchesInboxSearch(invoice(), "120")).toBe(true);
    expect(matchesInboxSearch(invoice(), "railway")).toBe(false);
    expect(matchesInboxSearch(invoice(), "")).toBe(true);
  });
});
