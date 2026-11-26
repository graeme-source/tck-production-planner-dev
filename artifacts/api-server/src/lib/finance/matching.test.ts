import { describe, it, expect } from "vitest";
import { looksLikeReceipt, scoreLineAgainstEmail, suggestMatches, type EmailForMatch, type LineForMatch } from "./matching";

const line = (over: Partial<LineForMatch> = {}): LineForMatch => ({
  id: 1,
  merchant: "SCREWFIX DIRECT",
  descriptor: "SCREWFIX DIRECT - YEOVIL - Card Ending: 3465",
  amount: "15.98",
  originalAmount: null,
  authDate: "2026-08-02",
  lineDate: "2026-08-03",
  vendorDomains: [],
  ...over,
});

const email = (over: Partial<EmailForMatch> = {}): EmailForMatch => ({
  id: 10,
  fromDomain: "screwfix.com",
  fromAddress: "orders@screwfix.com",
  subject: "Your Screwfix order",
  internalDate: new Date("2026-08-02T10:00:00Z"),
  hasPdf: true,
  amountsFound: ["15.98"],
  orderIdsFound: [],
  ...over,
});

describe("scoreLineAgainstEmail", () => {
  it("regression 19 Nov 2026: never offers a £150.00 Anthropic receipt for a £15.00 Anthropic charge", () => {
    const charge = line({ merchant: "Anthropic", descriptor: "Anthropic", amount: "15.00", authDate: "2026-10-24", lineDate: "2026-10-24" });
    const receipt = email({ fromDomain: "mail.anthropic.com", fromAddress: "invoice+statements@mail.anthropic.com",
      subject: "Your receipt from Anthropic, PBC #2661-7226-1896", internalDate: new Date("2026-10-28T08:30:00Z"), amountsFound: ["150.00"] });
    expect(scoreLineAgainstEmail(charge, receipt)).toBeNull();
  });

  it("still offers a same-supplier email that states no amount at all", () => {
    const s = scoreLineAgainstEmail(line(), email({ amountsFound: [] }));
    expect(s).not.toBeNull();
  });

  it("scores highly on amount + merchant + pdf in the tight window", () => {
    const s = scoreLineAgainstEmail(line(), email());
    expect(s).not.toBeNull();
    expect(s!.score).toBeGreaterThanOrEqual(80);
    expect(s!.reasons.join(" ")).toMatch(/amount 15.98/);
  });

  it("rejects emails outside the date window", () => {
    expect(scoreLineAgainstEmail(line(), email({ internalDate: new Date("2026-06-01") }))).toBeNull();
    expect(scoreLineAgainstEmail(line(), email({ internalDate: new Date("2026-08-20") }))).toBeNull();
  });

  it("never suggests on date proximity alone", () => {
    const s = scoreLineAgainstEmail(
      line({ merchant: "OBSCURE VENDOR" }),
      email({ fromDomain: "unrelated.io", fromAddress: "hi@unrelated.io", subject: "hello", amountsFound: [], hasPdf: false })
    );
    expect(s).toBeNull();
  });

  it("a PDF plus a close date is NOT evidence — needs amount or merchant", () => {
    // The Starlink/Puffin case (2026-08-28): unrelated supplier, right
    // week, PDF attached — must not be suggested.
    const s = scoreLineAgainstEmail(
      line({ merchant: "STARLINK INTERNET" }),
      email({ fromDomain: "puffinpackaging.co.uk", fromAddress: "orders@puffinpackaging.co.uk", subject: "Sales Shipment 109077", amountsFound: [], hasPdf: true })
    );
    expect(s).toBeNull();
  });

  it("matches the supplier-side original amount for foreign-currency lines", () => {
    const s = scoreLineAgainstEmail(
      line({ merchant: "RAILWAY", descriptor: "RAILWAY", amount: "14.93", originalAmount: "20.00" }),
      email({ fromDomain: "railway.app", fromAddress: "billing@railway.app", subject: "Railway receipt", amountsFound: ["20.00"] })
    );
    expect(s).not.toBeNull();
    expect(s!.reasons.join(" ")).toMatch(/amount/);
  });

  it("credits a known vendor domain above name similarity", () => {
    const known = scoreLineAgainstEmail(line({ vendorDomains: ["screwfix.com"] }), email());
    const unknown = scoreLineAgainstEmail(line(), email());
    expect(known!.score).toBeGreaterThan(unknown!.score);
  });
});

describe("strength tiers (Graeme's 1-4 signal grading)", () => {
  it("amount+date+name = strong; +reference = very strong", () => {
    const strong = scoreLineAgainstEmail(line(), email());
    expect(strong!.signals).toBe(3);
    expect(strong!.strength).toBe("strong");
    const veryStrong = scoreLineAgainstEmail(
      line({ descriptor: "SCREWFIX F57441505 - Card Ending: 3465" }),
      email({ subject: "Your Screwfix order F57441505" })
    );
    expect(veryStrong!.signals).toBe(4);
    expect(veryStrong!.strength).toBe("very_strong");
  });

  it("amount alone outside the week window = weak", () => {
    const s = scoreLineAgainstEmail(
      line({ merchant: "OBSCURE", descriptor: "OBSCURE" }),
      email({ fromDomain: "x.io", fromAddress: "a@x.io", subject: "receipt", internalDate: new Date("2026-07-20T10:00:00Z"), hasPdf: false })
    );
    expect(s!.signals).toBe(1);
    expect(s!.strength).toBe("weak");
  });
});

describe("suggestMatches", () => {
  it("ranks by score and caps at five", () => {
    const emails: EmailForMatch[] = Array.from({ length: 8 }, (_, i) =>
      email({ id: i + 1, hasPdf: i % 2 === 0 })
    );
    const out = suggestMatches(line(), emails);
    expect(out.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < out.length; i++) expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score);
  });

  it("drops weak candidates below the floor", () => {
    const weak = email({ amountsFound: [], hasPdf: false, fromDomain: "x.io", fromAddress: "a@x.io", subject: "nothing" });
    expect(suggestMatches(line(), [weak])).toHaveLength(0);
  });
});

describe("only receipts and invoices are suggested (Graeme, 26 Nov 2026)", () => {
  const google = line({ merchant: "Google Ads", descriptor: "Google Ads", amount: "500.00", authDate: "2026-10-17", lineDate: "2026-10-17" });
  const fromGoogle = (subject: string, over: Partial<EmailForMatch> = {}) =>
    email({ fromDomain: "google.com", fromAddress: "no-reply@accounts.google.com", subject, internalDate: new Date("2026-10-16T10:00:00Z"), hasPdf: false, amountsFound: [], ...over });

  it("drops the supplier's emails that aren't receipts: security alerts, approvals, reminders", () => {
    expect(scoreLineAgainstEmail(google, fromGoogle("Security alert"))).toBeNull();
    expect(scoreLineAgainstEmail(google, fromGoogle("Your profile is missing business hours"))).toBeNull();
    const facebook = line({ merchant: "FACEBOOK", descriptor: "FACEBK *R34UPES4K4", amount: "1681.88", authDate: "2026-11-09", lineDate: "2026-11-09" });
    expect(scoreLineAgainstEmail(facebook, email({ fromDomain: "business-updates.facebook.com", fromAddress: "noreply@business-updates.facebook.com", subject: "Your ads were approved", internalDate: new Date("2026-11-10T10:00:00Z"), hasPdf: false, amountsFound: [] }))).toBeNull();
  });

  it("keeps the supplier's billing emails, even with no amount read: weak on the name alone", () => {
    const s = scoreLineAgainstEmail(google, fromGoogle("Google Ads: Your billing document is ready"))!;
    expect(s).not.toBeNull();
    expect(looksLikeReceipt(fromGoogle("You received a new receipt from CapCut"))).toBe(true);
  });

  it("doesn't count an amount found among a newsletter's prices", () => {
    const capcut = line({ merchant: "CAPCUT", descriptor: "CAPCUT", amount: "21.99", authDate: "2026-11-16", lineDate: "2026-11-16" });
    const prices = Array.from({ length: 40 }, (_, i) => (i === 7 ? "21.99" : (10 + i).toFixed(2)));
    const costcoDeals = email({ fromDomain: "e.costco.co.uk", fromAddress: "news@e.costco.co.uk", subject: "4 DAY DEALS! Save £300", internalDate: new Date("2026-11-15T10:00:00Z"), hasPdf: false, amountsFound: prices });
    expect(scoreLineAgainstEmail(capcut, costcoDeals)).toBeNull();
  });

  it("still finds a real receipt: amount, supplier and date is strong", () => {
    const costco = line({ merchant: "Costco online", descriptor: "Costco online", amount: "549.98", authDate: "2026-10-29", lineDate: "2026-10-29" });
    const s = scoreLineAgainstEmail(costco, email({ fromDomain: "email.costco.co.uk", fromAddress: "costcouk@email.costco.co.uk", subject: "Costco.co.uk Order Confirmation", internalDate: new Date("2026-10-29T10:00:00Z"), hasPdf: false, amountsFound: ["549.98", "999.98", "450.00"] }))!;
    expect(s.strength).toBe("strong");
  });
});

describe("never on a common word like EXPRESS (Graeme, 26 Nov 2026)", () => {
  const express = line({ merchant: "Express Foodservice", descriptor: "Express Foodservice", amount: "1656.67", authDate: "2026-11-10", lineDate: "2026-11-17" });
  it("doesn't put a Ducting Express invoice to an Express Foodservice charge", () => {
    const ducting = email({ fromDomain: "ducting-express.co.uk", fromAddress: "izaak@ducting-express.co.uk", subject: "Invoice 98905", internalDate: new Date("2026-11-09T10:00:00Z"), hasPdf: true, amountsFound: [] });
    expect(scoreLineAgainstEmail(express, ducting)).toBeNull();
    const parcel = email({ fromDomain: "dpd.co.uk", fromAddress: "yourorder@dpd.co.uk", subject: "We're expecting your Ducting Express Services parcel", internalDate: new Date("2026-11-09T10:00:00Z"), hasPdf: false, amountsFound: [] });
    expect(scoreLineAgainstEmail(express, parcel)).toBeNull();
  });
  it("still knows Express Foodservice by its whole name", () => {
    const own = email({ fromDomain: "expressfoodservice.co.uk", fromAddress: "accounts@expressfoodservice.co.uk", subject: "Your invoice", internalDate: new Date("2026-11-11T10:00:00Z"), hasPdf: true, amountsFound: [] });
    expect(scoreLineAgainstEmail(express, own)).not.toBeNull();
  });
  it("uses the next word when the first is common: Best Pubs, Screwfix Direct", () => {
    const pubs = line({ merchant: "Best Pubs", descriptor: "Best Pubs", amount: "200.00" });
    expect(scoreLineAgainstEmail(pubs, email({ fromAddress: "noreply@cakehead.co.uk", fromDomain: "cakehead.co.uk", subject: "Your best order", amountsFound: [] }))).toBeNull();
  });
});
