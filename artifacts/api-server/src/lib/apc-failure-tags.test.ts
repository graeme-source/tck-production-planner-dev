import { describe, it, expect } from "vitest";
import { isNoServiceFailure, APC_NO_SERVICE_TAG } from "./apc-failure-tags";

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
