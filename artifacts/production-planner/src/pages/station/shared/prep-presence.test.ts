import { describe, expect, it } from "vitest";
import { alsoViewingNames, othersViewing, type PrepPresenceData } from "./prep-presence";

// Fix queue #64: Bases & Sauces now shows who else is viewing an item, using
// the same shared presence helpers as Main Prep.
describe("prep presence", () => {
  const presence: PrepPresenceData = {
    12: [{ userId: 2, userName: "Jane" }, { userId: 3, userName: "Kyra" }],
    40: [],
  };

  it("names everyone else viewing the item", () => {
    expect(alsoViewingNames(presence, 12)).toBe("Jane, Kyra");
    expect(othersViewing(presence, 12)).toHaveLength(2);
  });

  it("draws no marker when nobody else is looking", () => {
    expect(alsoViewingNames(presence, 40)).toBeNull();
    expect(alsoViewingNames(presence, 99)).toBeNull();
    expect(alsoViewingNames(presence, null)).toBeNull();
    expect(alsoViewingNames(undefined, 12)).toBeNull();
  });
});
