import { describe, it, expect } from "vitest";
import { deliveryTagFor, showOutstandingCheck } from "./outstanding-dispatch-rules";

describe("deliveryTagFor", () => {
  it("is the day after dispatch — packing today goes out tomorrow", () => {
    expect(deliveryTagFor("2026-09-17")).toBe("2026-09-18");
  });

  it("rolls over a month end", () => {
    expect(deliveryTagFor("2026-09-30")).toBe("2026-10-01");
  });

  it("rolls over a year end", () => {
    expect(deliveryTagFor("2026-12-31")).toBe("2027-01-01");
  });

  it("holds through the BST→GMT switch, when a naive +24h lands on the wrong day", () => {
    // Clocks go back on 25 Oct 2026; anchoring at noon UTC keeps the date
    // unambiguous either side of it.
    expect(deliveryTagFor("2026-10-24")).toBe("2026-10-25");
    expect(deliveryTagFor("2026-10-25")).toBe("2026-10-26");
  });
});

describe("showOutstandingCheck", () => {
  it("hides on a day that finished clean — 115 out of 115", () => {
    expect(showOutstandingCheck(0)).toBe(false);
  });

  it("shows when anything is still to go out", () => {
    expect(showOutstandingCheck(1)).toBe(true);
    expect(showOutstandingCheck(12)).toBe(true);
  });

  it("SHOWS when the lookup failed — never hide on a guess", () => {
    // Hiding on an error would tell the team everything had gone out, which
    // is the one answer we must not give by accident.
    expect(showOutstandingCheck(null)).toBe(true);
  });
});
