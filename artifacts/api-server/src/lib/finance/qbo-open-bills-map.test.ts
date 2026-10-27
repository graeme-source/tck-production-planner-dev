import { describe, it, expect } from "vitest";
import { openBillsFromQbo, billsDueBy } from "./qbo-open-bills-map";

// Shaped like real QBO v3 Bill query rows (minorversion 75), trimmed.
function bill(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Id: "101",
    SyncToken: "0",
    domain: "QBO",
    sparse: false,
    MetaData: { CreateTime: "2026-10-01T09:12:44-07:00", LastUpdatedTime: "2026-10-01T09:12:44-07:00" },
    DocNumber: "INV-4471",
    TxnDate: "2026-10-01",
    DueDate: "2026-10-31",
    CurrencyRef: { value: "GBP", name: "British Pound Sterling" },
    VendorRef: { value: "56", name: "Bidfood" },
    APAccountRef: { value: "33", name: "Accounts Payable (Creditors)" },
    SalesTermRef: { value: "3" },
    TotalAmt: 1234.56,
    Balance: 1234.56,
    Line: [{ Id: "1", Amount: 1028.8, DetailType: "AccountBasedExpenseLineDetail" }],
    ...over,
  };
}

describe("openBillsFromQbo", () => {
  it("maps a standard bill", () => {
    expect(openBillsFromQbo([bill()])).toEqual([{
      id: "101",
      vendorId: "56",
      vendorName: "Bidfood",
      docNumber: "INV-4471",
      txnDate: "2026-10-01",
      dueDate: "2026-10-31",
      termsId: "3",
      termsName: null,
      balance: 1234.56,
      currency: "GBP",
    }]);
  });

  it("carries the payment terms name when QBO sends it, and nulls when the Bill has no terms (2026-10-27)", () => {
    expect(openBillsFromQbo([bill({ SalesTermRef: { value: "3", name: "Net 30" } })])[0]).toMatchObject({ termsId: "3", termsName: "Net 30" });
    const none = openBillsFromQbo([bill({ SalesTermRef: undefined, DueDate: undefined })])[0];
    expect(none).toMatchObject({ termsId: null, termsName: null, dueDate: null, txnDate: "2026-10-01" });
  });

  it("keeps a part-paid bill at its remaining balance", () => {
    const [b] = openBillsFromQbo([bill({ TotalAmt: 500, Balance: 200.1 })]);
    expect(b.balance).toBe(200.1);
  });

  it("skips zero, negative and missing balances", () => {
    const out = openBillsFromQbo([
      bill({ Id: "1", Balance: 0 }),
      bill({ Id: "2", Balance: -10 }),
      bill({ Id: "3", Balance: undefined }),
      bill({ Id: "4", Balance: 0.01 }),
    ]);
    expect(out.map(b => b.id)).toEqual(["4"]);
  });

  it("handles a missing DueDate, DocNumber and VendorRef", () => {
    const [b] = openBillsFromQbo([bill({ DueDate: undefined, DocNumber: undefined, VendorRef: undefined })]);
    expect(b.dueDate).toBeNull();
    expect(b.docNumber).toBeNull();
    expect(b.vendorId).toBeNull();
    expect(b.vendorName).toBe("Unknown supplier");
  });

  it("keeps the bill's own currency and defaults to GBP when absent", () => {
    const out = openBillsFromQbo([
      bill({ Id: "7", CurrencyRef: { value: "EUR", name: "Euro" }, ExchangeRate: 0.86, Balance: 4617.75 }),
      bill({ Id: "8", CurrencyRef: undefined }),
    ]);
    expect(out.find(b => b.id === "7")).toMatchObject({ currency: "EUR", balance: 4617.75 });
    expect(out.find(b => b.id === "8")?.currency).toBe("GBP");
  });

  it("trims timestamps to YYYY-MM-DD and accepts string balances", () => {
    const [b] = openBillsFromQbo([bill({ TxnDate: "2026-10-02T00:00:00Z", DueDate: "2026-11-01T00:00:00-07:00", Balance: "99.999" })]);
    expect(b).toMatchObject({ txnDate: "2026-10-02", dueDate: "2026-11-01", balance: 100 });
  });

  it("ignores junk rows and rows without Id or TxnDate", () => {
    const out = openBillsFromQbo([null, "x", 42, bill({ Id: undefined }), bill({ Id: "9", TxnDate: undefined })]);
    expect(out).toEqual([]);
  });

  it("merges paged results, de-duplicating overlap and sorting by due date", () => {
    const page1 = [
      bill({ Id: "1", DueDate: "2026-11-15", VendorRef: { value: "1", name: "Meat Co" } }),
      bill({ Id: "2", DueDate: "2026-10-20", VendorRef: { value: "2", name: "Packaging Ltd" } }),
    ];
    const page2 = [
      bill({ Id: "2", DueDate: "2026-10-20", Balance: 50, VendorRef: { value: "2", name: "Packaging Ltd" } }),
      bill({ Id: "3", DueDate: undefined, TxnDate: "2026-10-05", VendorRef: { value: "3", name: "Flour Mill" } }),
    ];
    const out = openBillsFromQbo([...page1, ...page2]);
    expect(out.map(b => b.id)).toEqual(["3", "2", "1"]);
    expect(out.find(b => b.id === "2")?.balance).toBe(50);
  });
});

describe("billsDueBy", () => {
  const bills = openBillsFromQbo([
    bill({ Id: "a", DueDate: "2026-10-10" }),
    bill({ Id: "b", DueDate: "2026-10-26" }),
    bill({ Id: "c", DueDate: "2026-10-27" }),
    bill({ Id: "d", DueDate: undefined, TxnDate: "2026-09-30" }),
  ]);

  it("returns bills due on or before the date, most overdue first", () => {
    expect(billsDueBy(bills, "2026-10-26").map(b => b.id)).toEqual(["d", "a", "b"]);
  });

  it("returns nothing when nothing is due yet", () => {
    expect(billsDueBy(bills, "2026-09-01")).toEqual([]);
  });
});
