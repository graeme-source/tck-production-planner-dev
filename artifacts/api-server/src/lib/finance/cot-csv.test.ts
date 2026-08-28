import { describe, it, expect } from "vitest";
import { parseCotCsv, parseUkDate, splitCsvLine, cotDedupeHash } from "./cot-csv";

const HEADER =
  "Clearance Date,Authorisation Date,Description,Amount,Original Amount,Original Currency,Merchant Name,Card Ending,Cardholder Name,Card Name,Transaction Type,Category,Has Receipts,Note";

describe("parseCotCsv", () => {
  it("parses a purchase row from the real export shape", () => {
    const csv = [
      HEADER,
      "27/08/2026,26/08/2026,HPI INSTANT INK UK - WWW.HP.COM - Card Ending: 3465,20.99,20.99, GBP,HPI INSTANT INK UK,3465,Graeme Carter,,Online,General,No,",
    ].join("\n");
    const { rows, skippedRepayments } = parseCotCsv(csv);
    expect(skippedRepayments).toBe(0);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.clearanceDate).toBe("2026-08-27");
    expect(r.authDate).toBe("2026-08-26");
    expect(r.amount).toBe("20.99");
    expect(r.merchant).toBe("HPI INSTANT INK UK");
    expect(r.cardLast4).toBe("3465");
    expect(r.cardholder).toBe("Graeme Carter");
    expect(r.originalCurrency).toBe("GBP");
  });

  it("keeps foreign-currency original amounts", () => {
    const csv = [
      HEADER,
      "02/08/2026,01/08/2026,RAILWAY - +14157077675 - Card Ending: 9275,14.93,20.00, USD,RAILWAY,9275,Graeme Carter,,Over the phone,General,No,",
    ].join("\n");
    const { rows } = parseCotCsv(csv);
    expect(rows[0].amount).toBe("14.93");
    expect(rows[0].originalAmount).toBe("20.00");
    expect(rows[0].originalCurrency).toBe("USD");
  });

  it("excludes repayment rows", () => {
    const csv = [
      HEADER,
      "24/08/2026,24/08/2026,Payment made (VirtualBankTransfer),-5000.00,-5000.00, ,,,,,Other,Inbound payment,No,",
      "25/08/2026,24/08/2026,SIMPLISAFE UK - 8009202420 - Card Ending: 9275,12.99,12.99, GBP,SIMPLISAFE UK,9275,Graeme Carter,,Online,Services,No,",
    ].join("\n");
    const { rows, skippedRepayments } = parseCotCsv(csv);
    expect(skippedRepayments).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].descriptor).toContain("SIMPLISAFE");
  });

  it("is deterministic on dedupe hashes so re-uploads are safe", () => {
    const parts = {
      source: "capital_on_tap",
      clearanceDate: "2026-08-27",
      authDate: "2026-08-26",
      amount: "20.99",
      descriptor: "HPI INSTANT INK UK - WWW.HP.COM - Card Ending: 3465",
      cardLast4: "3465",
    };
    expect(cotDedupeHash(parts)).toBe(cotDedupeHash({ ...parts }));
    expect(cotDedupeHash(parts)).not.toBe(cotDedupeHash({ ...parts, amount: "21.99" }));
  });

  it("distinguishes same-day same-amount lines on different cards", () => {
    const base = {
      source: "capital_on_tap",
      clearanceDate: "2026-08-27",
      authDate: null,
      amount: "9.99",
      descriptor: "AMZNMktplace - amazon.co.uk",
    };
    expect(cotDedupeHash({ ...base, cardLast4: "3465" })).not.toBe(
      cotDedupeHash({ ...base, cardLast4: "7859" })
    );
  });

  it("refuses a changed export format instead of importing garbage", () => {
    const csv = ["Date,Description,Value", "27/08/2026,Something,12.00"].join("\n");
    expect(() => parseCotCsv(csv)).toThrow(/changed their export format|Unexpected column/);
  });

  it("rejects malformed dates and amounts", () => {
    expect(() => parseUkDate("2026-08-27")).toThrow();
    expect(() => parseUkDate("32/01/2026")).toThrow();
    const bad = [HEADER, "27/08/2026,,X,abc, , ,X,1,Y,,,,No,"].join("\n");
    expect(() => parseCotCsv(bad)).toThrow(/amount/i);
  });

  it("splits quoted CSV fields containing commas", () => {
    expect(splitCsvLine('a,"b, c",d')).toEqual(["a", "b, c", "d"]);
    expect(splitCsvLine('a,"say ""hi""",c')).toEqual(["a", 'say "hi"', "c"]);
  });
});
