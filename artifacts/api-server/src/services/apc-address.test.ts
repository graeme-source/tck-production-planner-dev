import { describe, expect, it } from "vitest";
import { normaliseAddress, ADDRESS_LINE_MAX } from "./apc";

// Regression tests for reshaping a Shopify address into APC's 35-character
// lines. A wrong address here doesn't fail loudly — it books, prints, and
// turns up as a parcel that couldn't be delivered, so every rule this file
// encodes came from a real order.
//
// Two incidents drive most of what follows (Graeme, 2026-08-26, dispatch
// 2026-08-27):
//   - #133252: "Thornton, thornton-cleveleys, fylde, lancs." was flagged for
//     review purely to drop "lancs" — a county the postcode already carries.
//     Being asked to approve that wastes the operator's attention on the one
//     screen where attention matters.
//   - #133138: "Warren Road North Somercotes, Van 313 the lawns" lost "Van
//     313 the lawns" — the pitch number, i.e. the only part that finds the
//     door. That must be flagged as critical, and it must be fixable.

describe("normaliseAddress — counties", () => {
  it("drops a trailing county instead of flagging the address for review", () => {
    // #133252. Previously truncated at 35 chars and pushed to "needs a look".
    const r = normaliseAddress(
      "12 Beach Road",
      "Thornton, thornton-cleveleys, fylde, lancs.",
      "Thornton-Cleveleys",
      { postcode: "FY5 1AA" },
    );
    expect(r.review).toHaveLength(0);
    expect(r.address2 ?? "").not.toMatch(/lancs/i);
  });

  it("unwinds several redundant trailing components at once", () => {
    const r = normaliseAddress(
      "1 High Street",
      "Someplace, Fylde, Lancashire, United Kingdom",
      "Blackpool",
      { postcode: "FY1 1AA" },
    );
    expect(r.address2 ?? "").not.toMatch(/lancashire|united kingdom/i);
    expect(r.review).toHaveLength(0);
  });

  it("never strips a county name that is the whole line — that is the town", () => {
    // "Durham" is both a county and a city. Removing it would leave the
    // address with no street information at all.
    const r = normaliseAddress("Durham", undefined, "Durham", { postcode: "DH1 3DE" });
    expect(r.address1).toBe("Durham");
  });

  it("keeps a county that is not the trailing component", () => {
    // Mid-line text is part of a real place name, not a redundant suffix.
    const r = normaliseAddress("2 Kent Road", undefined, "London", { postcode: "SE1 1AA" });
    expect(r.address1).toBe("2 Kent Road");
  });
});

describe("normaliseAddress — what gets dropped, and how much it matters", () => {
  it("flags a lost building identifier as critical and names the lost text", () => {
    // #133138 — the van number is what finds the door.
    // The loss is a CASCADE, which is what made it hard to see: line 1 is too
    // long, its tail is pushed down onto line 2, and line 2 — now carrying
    // both — is cut at the end. So the text that disappears is the one the
    // customer typed last, which is exactly where a pitch or flat number goes.
    const r = normaliseAddress(
      "The Lawns Caravan Park, Warren Road North Somercotes",
      "Van 313 the lawns",
      "Louth",
      { postcode: "LN11 7RB" },
    );
    const truncated = r.review.find(f => f.kind === "truncated");
    expect(truncated).toBeDefined();
    expect(truncated!.severity).toBe("critical");
    expect(truncated!.dropped).toMatch(/van 313/i);
    // The dropped text is carried on its own, not only inside the sentence:
    // the screen shows it separately.
    expect(truncated!.dropped).not.toMatch(/^Address line 2/);
  });

  it("does not leave a leading comma on the dropped text", () => {
    // The loss is a CASCADE, which is what made it hard to see: line 1 is too
    // long, its tail is pushed down onto line 2, and line 2 — now carrying
    // both — is cut at the end. So the text that disappears is the one the
    // customer typed last, which is exactly where a pitch or flat number goes.
    const r = normaliseAddress(
      "The Lawns Caravan Park, Warren Road North Somercotes",
      "Van 313 the lawns",
      "Louth",
      { postcode: "LN11 7RB" },
    );
    const truncated = r.review.find(f => f.kind === "truncated");
    expect(truncated!.dropped).not.toMatch(/^[,\s]/);
  });

  it("treats a conflicting postcode as critical", () => {
    const r = normaliseAddress(
      "1 High Street, SW1A 1AA",
      undefined,
      "London",
      { postcode: "SE1 1AA" },
    );
    const flag = r.review.find(f => f.kind === "conflicting-postcode");
    expect(flag).toBeDefined();
    expect(flag!.severity).toBe("critical");
  });

  it("still removes a postcode that matches the order's own", () => {
    const r = normaliseAddress(
      "1 High Street, SE1 1AA",
      undefined,
      "London",
      { postcode: "SE1 1AA" },
    );
    expect(r.address1).not.toMatch(/SE1/);
    expect(r.review).toHaveLength(0);
  });
});

describe("normaliseAddress — the 35-character contract", () => {
  it("never emits a line longer than APC accepts", () => {
    const r = normaliseAddress(
      "The Old Rectory Farmhouse Longlands Lane Estate",
      "Behind the church, past the second gate on the left",
      "Kingston upon Thames",
      { postcode: "KT1 1AA" },
    );
    expect(r.address1.length).toBeLessThanOrEqual(ADDRESS_LINE_MAX);
    expect((r.address2 ?? "").length).toBeLessThanOrEqual(ADDRESS_LINE_MAX);
    expect(r.city.length).toBeLessThanOrEqual(ADDRESS_LINE_MAX);
  });

  it("does not strand a connector word at the end of a line", () => {
    const r = normaliseAddress(
      "The Coach House Aston in Makerfield Wigan Road",
      undefined,
      "Wigan",
      { postcode: "WN4 8DE" },
    );
    expect(r.address1).not.toMatch(/\b(in|on|upon|the|of|and|by)$/i);
  });

  it("lifts a delivery note out of the address line into instructions", () => {
    const r = normaliseAddress(
      "14 Orchard Close",
      "Please leave in the porch if nobody answers the door",
      "Leeds",
      { postcode: "LS1 1AA" },
    );
    expect(r.instructions).toMatch(/please leave/i);
    expect(r.address2 ?? "").not.toMatch(/please leave/i);
  });
});
