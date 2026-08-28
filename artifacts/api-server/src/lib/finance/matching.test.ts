import { describe, it, expect } from "vitest";
import { scoreLineAgainstEmail, suggestMatches, type EmailForMatch, type LineForMatch } from "./matching";

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
  ...over,
});

describe("scoreLineAgainstEmail", () => {
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
