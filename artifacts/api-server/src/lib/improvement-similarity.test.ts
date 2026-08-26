import { describe, it, expect } from "vitest";
import { tokenise, similarity, shortlistDuplicates } from "./improvement-similarity";

describe("tokenise", () => {
  it("drops filler words and punctuation", () => {
    expect([...tokenise("The tape gun is never where you need it!")].sort())
      .toEqual(["gun", "never", "tape", "where"]);
  });

  it("drops very short words", () => {
    expect(tokenise("a in on go up").size).toBe(0);
  });
});

describe("similarity", () => {
  it("scores the same sentence as identical", () => {
    expect(similarity("tape gun missing", "tape gun missing")).toBe(1);
  });

  it("scores unrelated text as nothing in common", () => {
    expect(similarity("tape gun missing", "fridge door broken")).toBe(0);
  });

  it("scores a re-worded report of the same problem in between", () => {
    const score = similarity(
      "The tape gun is never on the wrapping bench",
      "Tape gun keeps going missing from the wrapping bench",
    );
    expect(score).toBeGreaterThan(0.2);
    expect(score).toBeLessThan(1);
  });

  it("handles empty text without dividing by zero", () => {
    expect(similarity("", "tape gun")).toBe(0);
    expect(similarity("tape gun", "")).toBe(0);
  });
});

describe("shortlistDuplicates", () => {
  const candidates = [
    { id: 1, title: "Tape gun missing from wrapping bench", description: "Have to go and find it every time" },
    { id: 2, title: "Fridge door doesn't shut properly", description: "Seal is perished" },
    { id: 3, title: "Wrapping bench tape gun walks off", description: "Never where it should be" },
  ];

  it("surfaces both reports of the same problem, best first", () => {
    const found = shortlistDuplicates(
      { title: "Tape gun is never on the wrapping bench" },
      candidates,
    );
    // Which of the two scores higher is a detail of the wording, not
    // something the team would have an opinion about — so assert that both
    // are found and that they come back strongest-first, not a fixed order.
    expect(found.map(c => c.id).sort()).toEqual([1, 3]);
    expect(found[0]!.score).toBeGreaterThanOrEqual(found[1]!.score);
  });

  it("leaves unrelated reports out of the shortlist entirely", () => {
    const found = shortlistDuplicates({ title: "Tape gun missing" }, candidates);
    expect(found.map(c => c.id)).not.toContain(2);
  });

  it("returns nothing for a problem never reported before", () => {
    expect(shortlistDuplicates({ title: "Oven timer buzzer too quiet" }, candidates)).toEqual([]);
  });

  it("respects the limit", () => {
    const found = shortlistDuplicates({ title: "tape gun wrapping bench" }, candidates, { limit: 1 });
    expect(found).toHaveLength(1);
  });

  it("returns nothing when there's nothing to compare against", () => {
    expect(shortlistDuplicates({ title: "anything" }, [])).toEqual([]);
    expect(shortlistDuplicates({ title: "" }, candidates)).toEqual([]);
  });

  it("breaks ties by id so the same input always gives the same order", () => {
    const twins = [
      { id: 9, title: "tape gun missing", description: "" },
      { id: 4, title: "tape gun missing", description: "" },
    ];
    expect(shortlistDuplicates({ title: "tape gun missing" }, twins).map(c => c.id)).toEqual([4, 9]);
  });
});
