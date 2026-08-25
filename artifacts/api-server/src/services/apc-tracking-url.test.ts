import { describe, expect, it } from "vitest";
import { apcTrackingUrl } from "./apc";

// Regression tests for the customer tracking link. Two incidents behind
// these:
//  - 2026-08-03: apc-overnight.com/track-parcel.php began 301ing to the
//    apc.co.uk homepage and dropping its params — the link must use the
//    apc.co.uk widget-prefill form.
//  - 2026-08-25: createShipment was building its own
//    apc.hypaship.com/tracking?waybill=… link — a logged-in back-office
//    page that 404s for the public — and that stored value beat the
//    correct fulfil-time URL, so every auto-booked order since 2026-08-21
//    emailed customers a dead link. The customer link must come from
//    apcTrackingUrl and point at apc.co.uk, never at the Hypaship portal.
describe("apcTrackingUrl", () => {
  it("builds the apc.co.uk widget-prefill link with consignment and postcode", () => {
    expect(apcTrackingUrl("2026082503036990016457", "WN3 5NR")).toBe(
      "https://apc.co.uk/?consignment=2026082503036990016457&postcode=WN3+5NR",
    );
  });

  it("normalises postcode case and spacing, splitting before the 3-char inward code", () => {
    expect(apcTrackingUrl("123", "dy121rb")).toBe("https://apc.co.uk/?consignment=123&postcode=DY12+1RB");
    expect(apcTrackingUrl("123", "  w1a  1aa ")).toBe("https://apc.co.uk/?consignment=123&postcode=W1A+1AA");
  });

  it("omits the postcode param when no postcode is known", () => {
    expect(apcTrackingUrl("123", null)).toBe("https://apc.co.uk/?consignment=123");
    expect(apcTrackingUrl("123", "")).toBe("https://apc.co.uk/?consignment=123");
  });

  it("never points at the Hypaship back-office portal or the dead track-parcel.php", () => {
    const url = apcTrackingUrl("2026082503036990016457", "WN3 5NR");
    expect(url).not.toContain("hypaship.com");
    expect(url).not.toContain("track-parcel.php");
    expect(url.startsWith("https://apc.co.uk/")).toBe(true);
  });
});
