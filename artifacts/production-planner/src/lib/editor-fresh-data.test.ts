import { describe, it, expect } from "vitest";
import { editFormReady } from "./editor-fresh-data";

describe("editFormReady", () => {
  it("waits for a fresh copy when an old one is in memory (the reopened sub-recipe)", () => {
    expect(editFormReady({ hasData: true, fetchedSinceOpen: false })).toBe(false);
  });

  it("shows the form once the fresh copy is in", () => {
    expect(editFormReady({ hasData: true, fetchedSinceOpen: true })).toBe(true);
  });

  it("never shows an empty form", () => {
    expect(editFormReady({ hasData: false, fetchedSinceOpen: true })).toBe(false);
  });
});
