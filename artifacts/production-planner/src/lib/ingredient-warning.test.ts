import { describe, expect, it } from "vitest";
import { markSeen, parseSeen, warningsToShow, type StationWarning } from "./ingredient-warning";

// Fix queue #404: the "watch for bones" pop-up shows once per person, per
// recipe, per day — and never for a recipe with no warning.
const bones: StationWarning[] = [{ ingredientId: 24, ingredientName: "Shredded bird", warning: "Please be vigilant for bones." }];
const today = "2026-11-20";

describe("warningsToShow", () => {
  it("shows nothing for a recipe with no warning, or no recipe", () => {
    expect(warningsToShow({ warnings: undefined, recipeId: 8, userId: 7, today, seen: null })).toEqual([]);
    expect(warningsToShow({ warnings: [], recipeId: 8, userId: 7, today, seen: null })).toEqual([]);
    expect(warningsToShow({ warnings: bones, recipeId: null, userId: 7, today, seen: null })).toEqual([]);
  });

  it("shows the warning the first time a person opens the recipe", () => {
    expect(warningsToShow({ warnings: bones, recipeId: 8, userId: 7, today, seen: null })).toEqual(bones);
  });

  it("stays quiet for the rest of the day once that person taps Got it", () => {
    const seen = markSeen(null, { warnings: bones, recipeId: 8, userId: 7, today });
    expect(warningsToShow({ warnings: bones, recipeId: 8, userId: 7, today, seen })).toEqual([]);
  });

  it("still shows to a different person, on a different recipe, and the next day", () => {
    const seen = markSeen(null, { warnings: bones, recipeId: 8, userId: 7, today });
    expect(warningsToShow({ warnings: bones, recipeId: 8, userId: 11, today, seen })).toEqual(bones);
    expect(warningsToShow({ warnings: bones, recipeId: 9, userId: 7, today, seen })).toEqual(bones);
    expect(warningsToShow({ warnings: bones, recipeId: 8, userId: 7, today: "2026-11-21", seen })).toEqual(bones);
  });

  it("shows again when the wording changes", () => {
    const seen = markSeen(null, { warnings: bones, recipeId: 8, userId: 7, today });
    const reworded = [{ ...bones[0]!, warning: "Check every tray for bones." }];
    expect(warningsToShow({ warnings: reworded, recipeId: 8, userId: 7, today, seen })).toEqual(reworded);
  });
});

describe("markSeen / parseSeen", () => {
  it("keeps today's ticks and drops yesterday's", () => {
    const yesterday = markSeen(null, { warnings: bones, recipeId: 8, userId: 7, today: "2026-11-19" });
    const now = markSeen(yesterday, { warnings: bones, recipeId: 8, userId: 11, today });
    expect(now.day).toBe(today);
    expect(now.keys).toHaveLength(1);
    const both = markSeen(now, { warnings: bones, recipeId: 8, userId: 7, today });
    expect(both.keys).toHaveLength(2);
    expect(markSeen(both, { warnings: bones, recipeId: 8, userId: 7, today }).keys).toHaveLength(2);
  });

  it("round-trips through storage and ignores rubbish", () => {
    const seen = markSeen(null, { warnings: bones, recipeId: 8, userId: 7, today });
    expect(parseSeen(JSON.stringify(seen))).toEqual(seen);
    expect(parseSeen(null)).toBeNull();
    expect(parseSeen("not json")).toBeNull();
    expect(parseSeen('{"day":5}')).toBeNull();
  });
});
