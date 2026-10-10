import { describe, it, expect } from "vitest";
import { decideStatus, publishBlockers } from "./status";

const base = { isDraft: false, archived: false, hasLive: true, matchesLive: true, currentFits: true };

describe("label status", () => {
  it("live & up to date when the current label matches the published one", () => {
    expect(decideStatus(base)).toBe("live");
  });
  it("update needed when something changed — and live again once it's changed back", () => {
    expect(decideStatus({ ...base, matchesLive: false })).toBe("update-needed");
    expect(decideStatus({ ...base, matchesLive: true })).toBe("live");
  });
  it("doesn't fit outranks update needed / never published", () => {
    expect(decideStatus({ ...base, matchesLive: false, currentFits: false })).toBe("doesnt-fit");
    expect(decideStatus({ ...base, hasLive: false, matchesLive: false, currentFits: false })).toBe("doesnt-fit");
  });
  it("never published", () => {
    expect(decideStatus({ ...base, hasLive: false, matchesLive: false })).toBe("never-published");
  });
  it("draft and archived recipes say so", () => {
    expect(decideStatus({ ...base, isDraft: true })).toBe("draft-recipe");
    expect(decideStatus({ ...base, archived: true })).toBe("archived");
  });
});

describe("publish blockers", () => {
  it("nothing blocks a fitting, complete label", () => {
    expect(publishBlockers({ archived: false, fits: true, fitProblems: [], contentProblems: [], deckBlockers: [] })).toEqual([]);
  });
  it("lists every reason", () => {
    const b = publishBlockers({ archived: true, fits: false, fitProblems: ["Ingredients 2 mm over"], contentProblems: ["No barcode"], deckBlockers: ["Salt has no declaration"] });
    expect(b).toEqual(["This recipe is archived.", "Ingredients 2 mm over", "No barcode", "Salt has no declaration"]);
  });
});
