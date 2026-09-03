import { describe, it, expect } from "vitest";
import { isNoServiceFailure, isDataFixableFailure, APC_NO_SERVICE_TAG } from "./apc-failure-tags";

describe("isNoServiceFailure", () => {
  it("recognises the real APC coverage refusal", () => {
    // Verbatim from the 2026-08-22 batch.
    expect(isNoServiceFailure("APC order failed: NO Services available.")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isNoServiceFailure("apc order failed: no services available")).toBe(true);
  });

  it("does NOT tag an authentication failure", () => {
    // Our credentials, not their coverage. Tagging this would mark every
    // order in the wave undeliverable during an auth outage.
    expect(isNoServiceFailure("APC training auth/system error (not a postcode problem): Authentication Failed. Please check your credentials. (100019)")).toBe(false);
    expect(isNoServiceFailure("Authentication Failed. Please check your credentials. (100019)")).toBe(false);
  });

  it("does NOT tag a data problem we can fix ourselves", () => {
    expect(isNoServiceFailure("Missing address or postcode")).toBe(false);
  });

  it("does NOT tag a transport failure — it says nothing about coverage", () => {
    expect(isNoServiceFailure("APC label fetch failed (502): upstream timeout")).toBe(false);
    expect(isNoServiceFailure("fetch failed")).toBe(false);
  });

  it("handles empty and missing messages", () => {
    expect(isNoServiceFailure("")).toBe(false);
    expect(isNoServiceFailure(null)).toBe(false);
    expect(isNoServiceFailure(undefined)).toBe(false);
  });

  it("uses a stable, searchable tag", () => {
    // Shopify tag search is not case-sensitive but IS whitespace-sensitive;
    // keep it a single lowercase token.
    expect(APC_NO_SERVICE_TAG).toBe("apc-no-service");
    expect(APC_NO_SERVICE_TAG).not.toMatch(/\s/);
  });
});

describe("isDataFixableFailure", () => {
  // Verbatim from the 2026-09-03 batch — the failure that prompted the retry
  // button. Graeme shortened the city on the order and wanted to try again
  // without reopening the whole booking flow.
  const OVER_LONG_CITY =
    "APC order failed: CREATION FAILED — Delivery City: Enter a value less than 32 characters long";

  it("recognises a field the operator can correct on the order", () => {
    expect(isDataFixableFailure(OVER_LONG_CITY)).toBe(true);
  });

  it("recognises our own missing-address check", () => {
    expect(isDataFixableFailure("Missing address or postcode")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isDataFixableFailure("apc order failed: creation failed — delivery postcode: invalid")).toBe(true);
  });

  // A coverage refusal is not fixable on the order — the data is right, the
  // route is wrong. Telling the operator to "correct this in Shopify" would
  // send them looking for a fault that isn't there; rescheduling is the answer.
  it("does NOT claim a coverage refusal is fixable", () => {
    expect(isDataFixableFailure("APC order failed: NO Services available.")).toBe(false);
  });

  it("does NOT claim an authentication failure is fixable", () => {
    expect(isDataFixableFailure("Authentication Failed. Please check your credentials. (100019)")).toBe(false);
  });

  it("does NOT claim a transport failure is fixable", () => {
    expect(isDataFixableFailure("APC label fetch failed (502): upstream timeout")).toBe(false);
    expect(isDataFixableFailure("fetch failed")).toBe(false);
  });

  it("handles empty and missing messages", () => {
    expect(isDataFixableFailure("")).toBe(false);
    expect(isDataFixableFailure(null)).toBe(false);
    expect(isDataFixableFailure(undefined)).toBe(false);
  });

  it("never calls the same failure both fixable and a coverage refusal", () => {
    const messages = [
      OVER_LONG_CITY,
      "APC order failed: NO Services available.",
      "Missing address or postcode",
      "Authentication Failed. Please check your credentials. (100019)",
      "fetch failed",
    ];
    for (const m of messages) {
      expect(isDataFixableFailure(m) && isNoServiceFailure(m)).toBe(false);
    }
  });
});
