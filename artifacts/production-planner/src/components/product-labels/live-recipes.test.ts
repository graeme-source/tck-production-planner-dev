import { describe, expect, it } from "vitest";
import { liveRecipeIdSet } from "./api";

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
