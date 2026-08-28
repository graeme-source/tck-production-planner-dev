import { describe, it, expect } from "vitest";
import { CANONICAL_WASTE_NAMES, isCanonicalWaste, walkProgress } from "./curiosity-walk";
import { LMS_EIGHT_WASTES } from "./lean-corpus";

describe("the eight wastes served to Curiosity Time", () => {
  it("are exactly eight, in the Lean Made Simple order", () => {
    // The book's order is part of the feature — the walk teaches the wastes
    // in the same sequence the team meets them everywhere else. If this
    // fails, someone reordered or renamed the corpus; check with Graeme
    // before changing the expectation.
    expect(CANONICAL_WASTE_NAMES).toEqual([
      "Overproduction",
      "Transportation",
      "Inventory",
      "Defects",
      "Motion",
      "Overprocessing",
      "Waiting",
      "Waste of Skills",
    ]);
  });

  it("each carry a definition and a kitchen example for the walk screens", () => {
    for (const w of LMS_EIGHT_WASTES) {
      expect(w.definition.length).toBeGreaterThan(0);
      expect(w.kitchenExample.length).toBeGreaterThan(0);
    }
  });

  it("never use the banned DOWNTIME-style names", () => {
    // Terminology law (lean-corpus.ts): "Waste of Skills", never
    // "non-utilised talent" or "unused creativity".
    const allText = JSON.stringify(LMS_EIGHT_WASTES).toLowerCase();
    expect(allText).not.toContain("non-utilised");
    expect(allText).not.toContain("unused creativity");
    expect(allText).not.toContain("downtime");
  });
});

describe("isCanonicalWaste", () => {
  it("accepts every canonical name", () => {
    for (const name of CANONICAL_WASTE_NAMES) {
      expect(isCanonicalWaste(name)).toBe(true);
    }
  });

  it("rejects other lean literature's names and near-misses", () => {
    expect(isCanonicalWaste("Non-utilised talent")).toBe(false);
    expect(isCanonicalWaste("overproduction")).toBe(false); // case matters — stored verbatim
    expect(isCanonicalWaste("")).toBe(false);
  });
});

describe("walkProgress", () => {
  it("is empty for a fresh walk", () => {
    expect(walkProgress([])).toEqual({ answered: 0, spotted: 0, total: 8, complete: false });
  });

  it("counts answered and spotted separately", () => {
    const progress = walkProgress([
      { wasteName: "Overproduction", spotted: true },
      { wasteName: "Motion", spotted: false },
      { wasteName: "Waiting", spotted: true },
    ]);
    expect(progress).toEqual({ answered: 3, spotted: 2, total: 8, complete: false });
  });

  it("is complete only when all eight are answered", () => {
    const sevenAnswered = CANONICAL_WASTE_NAMES.slice(0, 7).map(name => ({ wasteName: name, spotted: false }));
    expect(walkProgress(sevenAnswered).complete).toBe(false);

    const allAnswered = CANONICAL_WASTE_NAMES.map(name => ({ wasteName: name, spotted: name === "Defects" }));
    expect(walkProgress(allAnswered)).toEqual({ answered: 8, spotted: 1, total: 8, complete: true });
  });

  it("ignores duplicates and non-canonical names", () => {
    const progress = walkProgress([
      { wasteName: "Defects", spotted: true },
      { wasteName: "Defects", spotted: false }, // duplicate — first row wins
      { wasteName: "Non-utilised talent", spotted: true }, // not canonical — ignored
    ]);
    expect(progress).toEqual({ answered: 1, spotted: 1, total: 8, complete: false });
  });
});
