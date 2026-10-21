import { describe, expect, it } from "vitest";
import {
  cleanOfferText, currentPublicOffers, customerGroupChip, dedupeOffers, isCustomerGroup, offerKey, offerSuggestions,
  offerUsage, offersMissingFromLibrary, offersSummary, reusePhase, searchPhases,
} from "./phases";

describe("customer group", () => {
  it("shows a chip only when the phase isn't for everyone", () => {
    expect(customerGroupChip("all")).toBeNull();
    expect(customerGroupChip(null)).toBeNull();
    expect(customerGroupChip("something-else")).toBeNull();
    expect(customerGroupChip("new")).toBe("New customers");
    expect(customerGroupChip("returning")).toBe("Returning");
    expect(customerGroupChip("subscription")).toBe("Subscribers");
  });
  it("knows the four groups", () => {
    expect(isCustomerGroup("subscription")).toBe(true);
    expect(isCustomerGroup("vip")).toBe(false);
  });
});

describe("offer library seeding / dedupe", () => {
  it("cleans spacing and treats case and spaces as the same offer", () => {
    expect(cleanOfferText("  Free pack   on orders over £39.95 ")).toBe("Free pack on orders over £39.95");
    expect(offerKey("FREE pack on  orders over £39.95")).toBe(offerKey("free pack on orders over £39.95"));
  });
  it("keeps the first spelling, drops empties, keeps order", () => {
    expect(dedupeOffers(["Free pack over £39.95", "", null, "  free PACK over £39.95 ", "Philly ending", undefined]))
      .toEqual(["Free pack over £39.95", "Philly ending"]);
  });
  it("finds the offers a phase adds to the library (archived ones count as there)", () => {
    const library = [{ text: "Free pack over £39.95" }, { text: "Old offer" }];
    expect(offersMissingFromLibrary(["free pack over £39.95", "Brand new", "OLD offer", "Brand  new"], library)).toEqual(["Brand new"]);
  });
  it("joins offers for the old single offer column", () => {
    expect(offersSummary([])).toBeNull();
    expect(offersSummary(["A", "a", "B"])).toBe("A; B");
  });
  it("suggests live, unchosen offers matching every typed word", () => {
    const lib = [
      { id: 1, text: "Free pack on orders over £39.95" },
      { id: 2, text: "Free pack on orders over £34.95", archived: true },
      { id: 3, text: "Philly Cheesesteak ending" },
      { id: 4, text: "Free gravy pot" },
    ];
    expect(offerSuggestions(lib, "free", []).map(o => o.id)).toEqual([1, 4]);
    expect(offerSuggestions(lib, "free pack", ["free pack on orders over £39.95"]).map(o => o.id)).toEqual([]);
    expect(offerSuggestions(lib, "", []).map(o => o.id)).toEqual([1, 3, 4]);
  });
  it("counts how many phases use each offer", () => {
    const n = offerUsage([{ offers: ["A", "a"] }, { offers: ["A", "B"] }]);
    expect(n.get(offerKey("a"))).toBe(2);
    expect(n.get(offerKey("b"))).toBe(1);
  });
});

describe("re-using a past phase", () => {
  const past = {
    title: "Halloween Week", startDate: "2025-10-27", endDate: "2025-11-01",
    offers: ["Free pack over £39.95"], customerGroup: "returning", notes: "Spooky",
  };
  it("copies name, offers, group and notes and keeps the length", () => {
    expect(reusePhase(past, "2026-10-26")).toEqual({
      title: "Halloween Week", startDate: "2026-10-26", endDate: "2026-10-31",
      offers: ["Free pack over £39.95"], customerGroup: "returning", notes: "Spooky", color: null,
    });
  });
  it("keeps the phase's colour; an unknown colour becomes the default", () => {
    expect(reusePhase({ ...past, color: "mint" }, "2026-10-26").color).toBe("mint");
    expect(reusePhase({ ...past, color: "violet-600" }, "2026-10-26").color).toBeNull();
  });
  it("keeps a one-day phase one day, across a month end and a clock change", () => {
    expect(reusePhase({ ...past, startDate: "2025-12-25", endDate: "2025-12-25" }, "2026-10-25"))
      .toMatchObject({ startDate: "2026-10-25", endDate: "2026-10-25" });
    expect(reusePhase({ ...past, startDate: "2025-01-30", endDate: "2025-02-02" }, "2026-03-28"))
      .toMatchObject({ startDate: "2026-03-28", endDate: "2026-03-31" });
  });
  it("falls back to all customers for an unknown group", () => {
    expect(reusePhase({ ...past, customerGroup: "vip" }, "2026-01-01").customerGroup).toBe("all");
  });
  it("searches by name or offer, newest first", () => {
    const phases = [
      { id: 1, title: "Halloween Week", offers: [], startDate: "2025-10-27" },
      { id: 2, title: "Black Friday", offers: ["Free pack over £39.95"], startDate: "2025-11-24" },
      { id: 3, title: "Halloween Again", offers: ["Free pack"], startDate: "2026-10-26" },
    ];
    expect(searchPhases(phases, "halloween").map(p => p.id)).toEqual([3, 1]);
    expect(searchPhases(phases, "free pack").map(p => p.id)).toEqual([3, 2]);
    expect(searchPhases(phases, "").map(p => p.id)).toEqual([3, 2, 1]);
  });
});

describe("offers running for everyone today", () => {
  it("lists all-customer phases covering today, never a (Product) placeholder", () => {
    const phases = [
      { startDate: "2026-10-19", endDate: "2026-10-25", offers: ["Free pack over £39.95", "£39.95 + (Product) added"], customerGroup: "all" },
      { startDate: "2026-10-20", endDate: "2026-10-20", offers: ["New customers 20% off"], customerGroup: "new" },
      { startDate: "2026-10-26", endDate: "2026-10-31", offers: ["Later"], customerGroup: "all" },
    ];
    expect(currentPublicOffers(phases, "2026-10-20")).toEqual(["Free pack over £39.95"]);
    expect(currentPublicOffers(phases, "2026-11-20")).toEqual([]);
  });
});
