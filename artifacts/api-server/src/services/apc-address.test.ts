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
  it("takes the county off the line but still reports the removal", () => {
    // #133252. The county is what blew the 35-character limit, and the
    // postcode already carries it — but Graeme reviews every real removal one
    // by one, so it is reported rather than dropped quietly (2026-08-26).
    const r = normaliseAddress(
      "12 Beach Road",
      "Thornton, thornton-cleveleys, fylde, lancs.",
      "Thornton-Cleveleys",
      { postcode: "FY5 1AA" },
    );
    expect(r.address1 + (r.address2 ?? "")).not.toMatch(/lancs/i);
    const flag = r.review.find(f => f.kind === "county-removed");
    expect(flag).toBeDefined();
    expect(flag!.dropped).toMatch(/lancs/i);
    // Mild: it must never outrank an address that genuinely will not fit.
    expect(flag!.severity).toBe("check");
    // Nothing else was lost — the county alone made it fit.
    expect(r.review.filter(f => f.kind === "truncated")).toHaveLength(0);
  });

  it("unwinds several redundant trailing components at once", () => {
    const r = normaliseAddress(
      "1 High Street",
      "Someplace, Fylde, Lancashire, United Kingdom",
      "Blackpool",
      { postcode: "FY1 1AA" },
    );
    expect(r.address2 ?? "").not.toMatch(/lancashire|united kingdom/i);
    // The country is the same fact we already send in its own field, so it is
    // not a "removal"; the county is, and is reported.
    expect(r.review.map(f => f.kind)).toEqual(["county-removed"]);
    expect(r.review[0]!.dropped).toMatch(/lancashire/i);
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

describe("normaliseAddress — the apartment number always survives", () => {
  // #133138, exactly as it sits in Shopify. The customer filled the
  // "Apartment, suite, etc" box correctly; the old packer split the 43-char
  // line 1, pushed its tail DOWN in front of line 2, then trimmed the end —
  // so the van number was evicted by text we had just moved. The most
  // specific part of the address was the one guaranteed to be lost.
  const realOrder = () => normaliseAddress(
    "Lakeside Park, Warren Road North Somercotes",
    "Van 313 the lawns",
    "Louth",
    { postcode: "LN11 7RB" },
  );

  it("keeps the van number AND the road, losing nothing", () => {
    const r = realOrder();
    const label = `${r.address1} ${r.address2 ?? ""}`;
    expect(label).toMatch(/van 313/i);
    expect(label).toMatch(/warren road/i);
    expect(r.review).toHaveLength(0);
  });

  it("leads with the sub-premise, the way a label should read", () => {
    expect(realOrder().address1.toLowerCase().startsWith("van 313")).toBe(true);
  });

  it("promotes a flat number out of the apartment field", () => {
    const r = normaliseAddress(
      "22 Longlands Estate Road, Little Chalfont",
      "Flat 4b",
      "Amersham",
      { postcode: "HP7 9QQ" },
    );
    expect(r.address1).toMatch(/^Flat 4b/i);
    expect(r.review).toHaveLength(0);
  });

  it("sacrifices the village before the road when something must go", () => {
    // Graeme, 2026-08-26: the postcode usually gets a driver to the road, but
    // "usually" is not good enough to throw the road name away.
    const r = normaliseAddress(
      "Flat 12, The Old Rectory Farmhouse Buildings",
      "Longlands Lane Estate, Upper Bumbleton",
      "Kingston upon Thames",
      { postcode: "KT1 1AA" },
    );
    const label = `${r.address1} ${r.address2 ?? ""}`;
    expect(label).toMatch(/flat 12/i);
    expect(label).toMatch(/longlands lane/i);
    // And the loss is reported for review, never made silently.
    expect(r.review.some(f => f.kind === "truncated")).toBe(true);
  });
});

describe("normaliseAddress — what gets dropped, and how much it matters", () => {
  it("names the lost text on its own, cleanly", () => {
    const r = normaliseAddress(
      "Utterly Enormous Manor House Buildings Annexe",
      "Somewhere Quite Long Indeed Estate, Little Bumbleton Magna",
      "Louth",
      { postcode: "LN11 7RB" },
    );
    const truncated = r.review.find(f => f.kind === "truncated");
    expect(truncated).toBeDefined();
    expect(truncated!.dropped).toBeTruthy();
    // Carried separately from the sentence, and never with a ragged edge.
    expect(truncated!.dropped).not.toMatch(/^Address line 2/);
    expect(truncated!.dropped).not.toMatch(/^[,\s]/);
  });

  it("reports nothing at all when the address fitted", () => {
    const r = normaliseAddress("14 Orchard Close", undefined, "Leeds", { postcode: "LS1 1AA" });
    expect(r.review).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
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
