import { describe, expect, it } from "vitest";
import { inboxEntries, inboxTotal, matchesInboxSearch } from "./finance-inbox";

const invoice = (over: Partial<Parameters<typeof matchesInboxSearch>[0]> = {}) => ({
  supplierName: "Toolstation", invoiceNumber: "INV-42", fileName: "receipt.pdf", notes: null, totalAmount: "120.00", ...over,
});

describe("Inbox", () => {
  it("shows the newest at the top, like an email inbox (27 Nov 2026)", () => {
    const e = (id: number, at: string | null) => ({ invoice: { id, awaitingTransactionAt: at } });
    const out = inboxEntries({
      check: [e(1, "2026-11-20T09:00:00Z")],
      waiting: [e(2, "2026-11-27T15:00:00Z"), e(3, "2026-11-25T10:00:00Z"), e(4, null)],
    });
    expect(out.map(x => x.invoice.id)).toEqual([2, 3, 1, 4]);
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

import { mergeInbox } from "./finance-inbox";

describe("mergeInbox (27 Nov 2026)", () => {
  it("mixes matched transactions and invoices, newest first", () => {
    const lines = [{ id: 1, at: "2026-11-27T10:00:00Z" }, { id: 2, at: "2026-11-20T10:00:00Z" }];
    const invs = [{ invoice: { id: 9 }, at: "2026-11-25T10:00:00Z" }, { invoice: { id: 8 }, at: "2026-11-27T12:00:00Z" }];
    const out = mergeInbox(lines, invs, l => l.at, e => e.at);
    expect(out.map(i => (i.kind === "matched" ? `m${i.line.id}` : `i${i.entry.invoice.id}`))).toEqual(["i8", "m1", "i9", "m2"]);
  });
});
