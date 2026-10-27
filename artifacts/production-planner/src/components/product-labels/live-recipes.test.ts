import { describe, expect, it } from "vitest";
import { liveRecipeIdSet, wrappingLabelAction } from "./api";

describe("Print back labels only for published labels (Graeme, 2026-10-19: mac cheese showed it, never published)", () => {
  const live = liveRecipeIdSet([1, 2, 3, 26]); // calzones with a live label
  it("shows for a recipe with a published label", () => {
    expect(live.has(26)).toBe(true);
  });
  it("hides for a recipe never published (Big Nanny's Macaroni Cheese, 15)", () => {
    expect(live.has(15)).toBe(false);
  });
  it("hides everything while the list hasn't loaded", () => {
    expect(liveRecipeIdSet(undefined).size).toBe(0);
  });
});

describe("wrapping label action (Graeme, 2026-10-19: unbuilt labels say 'Use Label Live')", () => {
  const live = liveRecipeIdSet([1, 26]);
  it("print button for a published label", () => expect(wrappingLabelAction(live, 26)).toBe("print"));
  it("'Use Label Live' instruction for a recipe with no label yet", () => expect(wrappingLabelAction(live, 15)).toBe("label-live"));
  it("nothing while the list is loading", () => expect(wrappingLabelAction(null, 15)).toBeNull());
});

describe("wrapping vs despatch label at the wrapping station (Graeme, 2026-10-27: cinnamon buns)", () => {
  const live = liveRecipeIdSet([1, 26, 27]);
  const wrapping = new Map([[27, { live: false }]]);
  it("a recipe with a wrapping label prints that one (the freezer label), even before it is published", () => {
    expect(wrappingLabelAction(live, 27, wrapping)).toBe("print-wrapping");
    expect(wrappingLabelAction(liveRecipeIdSet([1]), 27, wrapping)).toBe("print-wrapping");
  });
  it("every other recipe is unchanged: its back label", () => {
    expect(wrappingLabelAction(live, 26, wrapping)).toBe("print");
    expect(wrappingLabelAction(live, 15, wrapping)).toBe("label-live");
  });
});
