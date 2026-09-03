import { describe, it, expect } from "vitest";
import { tokeniseTitle, titleSimilarity, rankSops } from "./sop-search";

const sop = (title: string) => ({ id: title.length, title });

// Titles taken from the real library so the thresholds are tuned against
// what the kitchen actually has, not invented examples.
const LIBRARY = [
  sop("Air Con Check"),
  sop("Garlic butter Spreading"),
  sop("The Don Burger Prep"),
  sop("Icing cinnamon buns"),
  sop("Turning Blast Chiller On/Off"),
  sop("Washing cloths and tea towels"),
  sop("Raw meat stock rotation"),
];

describe("tokeniseTitle", () => {
  it("drops punctuation, stop words and short words", () => {
    expect([...tokeniseTitle("Turning Blast Chiller On/Off")]).toEqual(["turning", "blast", "chiller"]);
  });

  it("is empty for a title with nothing meaningful in it", () => {
    expect(tokeniseTitle("Is it on?").size).toBe(0);
  });
});

describe("titleSimilarity", () => {
  it("scores an identical title 1", () => {
    expect(titleSimilarity("Icing cinnamon buns", "Icing cinnamon buns")).toBe(1);
  });

  it("scores unrelated titles 0", () => {
    expect(titleSimilarity("Switch on air vent switch", "Washing cloths and tea towels")).toBe(0);
  });

  it("scores a shared word between 0 and 1", () => {
    const score = titleSimilarity("Switch on air vent switch", "Air Con Check");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe("rankSops", () => {
  it("shows the library head when nothing is typed", () => {
    const { matches, similar } = rankSops("", LIBRARY, { matchLimit: 3 });
    expect(matches).toHaveLength(3);
    expect(matches[0].title).toBe("Air Con Check");
    expect(similar).toEqual([]);
  });

  it("matches on a substring, case-insensitively", () => {
    const { matches } = rankSops("cinnamon", LIBRARY);
    expect(matches.map(m => m.title)).toEqual(["Icing cinnamon buns"]);
  });

  // The case the old substring-only filter got wrong: pre-filling the title
  // from a checklist task found nothing, so the next tap made a duplicate.
  it("surfaces a related SOP when the substring search finds nothing", () => {
    const { matches, similar } = rankSops("Switch on air vent switch", LIBRARY);
    expect(matches).toEqual([]);
    expect(similar.map(s => s.title)).toContain("Air Con Check");
  });

  it("never repeats a substring match in the similar band", () => {
    const { matches, similar } = rankSops("Air Con Check", LIBRARY);
    expect(matches.map(m => m.title)).toEqual(["Air Con Check"]);
    expect(similar.map(s => s.title)).not.toContain("Air Con Check");
  });

  it("keeps unrelated SOPs out of the similar band", () => {
    const { similar } = rankSops("Icing cinnamon buns", LIBRARY);
    expect(similar.map(s => s.title)).not.toContain("Raw meat stock rotation");
  });

  it("honours the limits", () => {
    const many = Array.from({ length: 40 }, (_, i) => sop(`Cleaning bench ${i}`));
    const { matches, similar } = rankSops("cleaning", many, { matchLimit: 5, similarLimit: 2 });
    expect(matches).toHaveLength(5);
    expect(similar.length).toBeLessThanOrEqual(2);
  });
});
