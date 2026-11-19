import { describe, it, expect } from "vitest";
import {
  inUseIntervals, productionWindow, lotsInWindow, plansTouchedBy, normaliseBatchCode,
  looksLikeOurPackCode, parseLotLabel,
} from "./traceability";

const at = (iso: string) => new Date(iso);

describe("inUseIntervals", () => {
  it("keeps a batch in use until a pack is opened on a later day", () => {
    const iv = inUseIntervals([
      { id: 1, ingredientId: 7, openedAt: at("2026-11-17T08:00:00Z") },
      { id: 2, ingredientId: 7, openedAt: at("2026-11-17T13:00:00Z") }, // second pack, same day
      { id: 3, ingredientId: 7, openedAt: at("2026-11-19T09:00:00Z") },
      { id: 4, ingredientId: 9, openedAt: at("2026-11-18T09:00:00Z") },
    ]);
    const byId = new Map(iv.map(i => [i.open.id, i]));
    expect(byId.get(1)!.end).toEqual(at("2026-11-19T09:00:00Z")); // not ended by the same-day pack
    expect(byId.get(2)!.end).toEqual(at("2026-11-19T09:00:00Z"));
    expect(byId.get(3)!.end).toBeNull();
    expect(byId.get(4)!.end).toBeNull(); // other ingredients don't end it
  });
});

describe("productionWindow", () => {
  it("runs from the previous plan's day to the end of the production day (London)", () => {
    const w = productionWindow("2026-11-23", "2026-11-20");
    expect(w.start).toEqual(at("2026-11-20T00:00:00Z")); // GMT in November
    expect(w.end).toEqual(at("2026-11-24T00:00:00Z"));
  });

  it("uses the day before after a long break", () => {
    expect(productionWindow("2026-11-23", "2026-10-01").start).toEqual(at("2026-11-22T00:00:00Z"));
    expect(productionWindow("2026-11-23", null).start).toEqual(at("2026-11-22T00:00:00Z"));
  });

  it("follows British Summer Time", () => {
    expect(productionWindow("2026-07-15", "2026-07-14").start).toEqual(at("2026-07-13T23:00:00Z"));
  });
});

describe("lotsInWindow and plansTouchedBy", () => {
  const iv = inUseIntervals([
    { id: 1, ingredientId: 7, openedAt: at("2026-11-16T08:00:00Z") },
    { id: 2, ingredientId: 7, openedAt: at("2026-11-19T15:00:00Z") },
  ]);

  it("lists both batches for a day where the pack changed", () => {
    const w = productionWindow("2026-11-19", "2026-11-18");
    expect(lotsInWindow(iv, w.start, w.end).map(i => i.open.id).sort()).toEqual([1, 2]);
  });

  it("lists only the old batch before the change", () => {
    const w = productionWindow("2026-11-18", "2026-11-17");
    expect(lotsInWindow(iv, w.start, w.end).map(i => i.open.id)).toEqual([1]);
  });

  it("finds the production days a batch could be in", () => {
    const plans = [
      { planDate: "2026-11-16", previousPlanDate: "2026-11-13" },
      { planDate: "2026-11-18", previousPlanDate: "2026-11-16" },
      { planDate: "2026-11-20", previousPlanDate: "2026-11-19" },
      { planDate: "2026-11-23", previousPlanDate: "2026-11-20" },
    ];
    const first = iv.find(i => i.open.id === 1)!;
    expect(plansTouchedBy(first, plans).map(p => p.planDate)).toEqual(["2026-11-16", "2026-11-18", "2026-11-20"]);
  });
});

describe("codes", () => {
  it("compares supplier codes loosely", () => {
    expect(normaliseBatchCode(" l 2345-b ")).toBe("L2345B");
  });
  it("spots our own pack codes", () => {
    expect(looksLikeOurPackCode("26323")).toBe(true);
    expect(looksLikeOurPackCode("L26323")).toBe(false);
  });
});

describe("parseLotLabel", () => {
  it("keeps a clean read", () => {
    expect(parseLotLabel({ batchCode: " L4471 ", useBy: "2026-11-25" })).toEqual({ batchCode: "L4471", useBy: "2026-11-25" });
  });
  it("drops guesses and junk", () => {
    expect(parseLotLabel({ batchCode: "N/A", useBy: "25 Nov" })).toEqual({ batchCode: null, useBy: null });
    expect(parseLotLabel(null)).toEqual({ batchCode: null, useBy: null });
  });
});
