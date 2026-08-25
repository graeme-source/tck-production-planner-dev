import { describe, it, expect } from "vitest";
import {
  earliestProductionDay,
  defaultDeliveryDay,
  earliestDespatchDay,
  earliestTagOnlyDeliveryDay,
  isDeliveryDay,
} from "./production-cutoff";

// 2026-08-25 is a Tuesday, and August in London is BST (UTC+1) — so 13:00Z is
// 2 p.m. on the kitchen wall clock.

describe("earliestProductionDay", () => {
  it("allows today's production before the 7 a.m. cutoff", () => {
    // 05:59Z = 06:59 London
    expect(earliestProductionDay(new Date("2026-08-25T05:59:00Z"))).toBe("2026-08-25");
  });

  it("moves to tomorrow at 7 a.m. exactly", () => {
    // 06:00Z = 07:00 London — "prior to 7 a.m." only, so 07:00 is too late
    expect(earliestProductionDay(new Date("2026-08-25T06:00:00Z"))).toBe("2026-08-26");
  });

  // Regression: an afternoon order was being suggested onto TODAY'S production
  // (Graeme, 2026-08-25).
  it("never suggests today for an afternoon order", () => {
    expect(earliestProductionDay(new Date("2026-08-25T13:00:00Z"))).toBe("2026-08-26");
  });

  it("uses the London clock in winter too (GMT)", () => {
    // 2026-01-15: London is UTC+0, so 06:30Z is before the cutoff, 07:30Z after
    expect(earliestProductionDay(new Date("2026-01-15T06:30:00Z"))).toBe("2026-01-15");
    expect(earliestProductionDay(new Date("2026-01-15T07:30:00Z"))).toBe("2026-01-16");
  });
});

describe("defaultDeliveryDay", () => {
  // Graeme's worked example (2026-08-25): order lands Tuesday afternoon →
  // produce Wednesday 26th, despatch Thursday 27th, deliver Friday 28th.
  it("adds two days to the earliest production day", () => {
    expect(defaultDeliveryDay(new Date("2026-08-25T13:00:00Z"))).toBe("2026-08-28");
  });

  it("keeps the earlier default when the order beats the cutoff", () => {
    // Before 7 a.m. Tuesday: produce Tue 25th, despatch Wed, deliver Thu 27th
    expect(defaultDeliveryDay(new Date("2026-08-25T05:30:00Z"))).toBe("2026-08-27");
  });

  it("skips past Sun/Mon to the next Tue–Sat delivery day", () => {
    // Friday 28th afternoon: earliest production Sat 29th, +2 = Mon 31st →
    // not a delivery day, so Tue 1 Sep
    expect(defaultDeliveryDay(new Date("2026-08-28T13:00:00Z"))).toBe("2026-09-01");
  });
});

describe("earliestDespatchDay", () => {
  it("allows today's despatch before the 2 p.m. cutoff", () => {
    // 12:59Z = 13:59 London (BST)
    expect(earliestDespatchDay(new Date("2026-08-25T12:59:00Z"))).toBe("2026-08-25");
  });

  it("moves to tomorrow at 2 p.m. exactly", () => {
    // 13:00Z = 14:00 London
    expect(earliestDespatchDay(new Date("2026-08-25T13:00:00Z"))).toBe("2026-08-26");
  });
});

describe("earliestTagOnlyDeliveryDay", () => {
  // Regression (Graeme, 2026-08-25): a 2-pack order processed on Tuesday
  // afternoon was offered Wednesday delivery, which needed a despatch that had
  // already sailed — despatch closes at 2 p.m., so the earliest is Thursday.
  it("skips next-day delivery once the 2 p.m. despatch has gone", () => {
    expect(earliestTagOnlyDeliveryDay(new Date("2026-08-25T14:30:00Z"))).toBe("2026-08-27");
  });

  it("still offers next-day delivery before 2 p.m.", () => {
    expect(earliestTagOnlyDeliveryDay(new Date("2026-08-25T09:00:00Z"))).toBe("2026-08-26");
  });

  it("rolls a weekend despatch forward to the Tuesday delivery", () => {
    // Friday 28th after 2 p.m.: earliest despatch Sat, but despatch runs
    // Mon–Fri (delivery Tue–Sat), so the next slot is Mon despatch → Tue 1 Sep
    expect(earliestTagOnlyDeliveryDay(new Date("2026-08-28T14:30:00Z"))).toBe("2026-09-01");
  });

  it("keeps Saturday delivery for a Friday morning order", () => {
    expect(earliestTagOnlyDeliveryDay(new Date("2026-08-28T09:00:00Z"))).toBe("2026-08-29");
  });
});

describe("isDeliveryDay", () => {
  it("accepts Tue–Sat and rejects Sun/Mon", () => {
    expect(isDeliveryDay("2026-08-25")).toBe(true); // Tue
    expect(isDeliveryDay("2026-08-29")).toBe(true); // Sat
    expect(isDeliveryDay("2026-08-30")).toBe(false); // Sun
    expect(isDeliveryDay("2026-08-31")).toBe(false); // Mon
  });
});
