import { describe, it, expect } from "vitest";
import { normaliseMerchant, merchantsLooselyMatch } from "./merchant-normalise";

describe("normaliseMerchant", () => {
  it("canonicalises platform descriptors from the real export", () => {
    expect(normaliseMerchant("AMZNMktplace")).toBe("AMAZON MARKETPLACE");
    expect(normaliseMerchant("AMZNBusiness")).toBe("AMAZON BUSINESS");
    expect(normaliseMerchant("AMAZON.CO.UK")).toBe("AMAZON");
    expect(normaliseMerchant("FACEBK *CXX8Z3N4K4")).toBe("FACEBOOK ADS");
    expect(normaliseMerchant("Google ADS9562308399")).toBe("GOOGLE ADS");
    expect(normaliseMerchant("APPLE.COM/BILL")).toBe("APPLE");
    expect(normaliseMerchant("SHOPIFY* 576929031")).toBe("SHOPIFY");
    expect(normaliseMerchant("ANTHROPIC* CLAUDE SUB")).toBe("ANTHROPIC");
    expect(normaliseMerchant("One.com")).toBe("ONE.COM");
    expect(normaliseMerchant("Indeed IEI26-02348456")).toBe("INDEED");
  });

  it("strips processor prefixes so the real merchant survives", () => {
    expect(normaliseMerchant("SP SAUCE SHOP WSALE")).toBe("SAUCE SHOP WSALE");
    expect(normaliseMerchant("SQ *CAKEHEAD LIMITED")).toBe("CAKEHEAD");
    expect(normaliseMerchant("SP DELICIOUSLY GUILT")).toBe("DELICIOUSLY GUILT");
  });

  it("reduces www-domains to their core", () => {
    expect(normaliseMerchant("WWW.CAKEHEAD.CO.UK")).toBe("CAKEHEAD");
    expect(normaliseMerchant("WWW.SCREWFIX.C")).toBe("SCREWFIX");
  });

  it("drops legal suffixes and trailing ids", () => {
    expect(normaliseMerchant("Salvo 1968 Ltd")).toBe("SALVO 1968");
    expect(normaliseMerchant("SLACK T011153GB4N")).toBe("SLACK T011153GB4N".toUpperCase());
    expect(normaliseMerchant("BUNZL C&H SUPPLIES")).toBe("BUNZL C&H SUPPLIES");
  });

  it("matches truncated descriptors prefix-tolerantly", () => {
    expect(merchantsLooselyMatch("WWW.SCREWFIX.C", "SCREWFIX DIRECT")).toBe(true);
    expect(merchantsLooselyMatch("SQ *CAKEHEAD LIMITED", "WWW.CAKEHEAD.CO.UK")).toBe(true);
    expect(merchantsLooselyMatch("SLACK T011153GB4N", "STARLINK INTERNET")).toBe(false);
    expect(merchantsLooselyMatch("", "SCREWFIX")).toBe(false);
  });
});
