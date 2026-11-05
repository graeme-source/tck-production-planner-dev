// Regression (Fix queue #390): an SOP can be attached to one supplier, so a
// how-to for ordering unusual items sits on that supplier's Orders card.
import { describe, expect, it } from "vitest";
import { sopLinkProblem } from "./sop-link-targets";
import { stationsForLink } from "./station-sop-scope";

const link = { sopId: 5, targetType: "supplier", a: 12, b: null, text: null };

describe("sopLinkProblem", () => {
  it("accepts a supplier link keyed by the supplier's id", () => {
    expect(sopLinkProblem(link)).toBeNull();
  });

  it("refuses a supplier link with no supplier", () => {
    expect(sopLinkProblem({ ...link, a: null })).toBe("Target reference missing");
  });

  it("still refuses an unknown place, and keeps the older rules", () => {
    expect(sopLinkProblem({ ...link, targetType: "planet" })).toBe("sopId and a valid targetType are required");
    expect(sopLinkProblem({ ...link, targetType: "page", a: null })).toBe("Target reference missing");
    expect(sopLinkProblem({ ...link, targetType: "page", a: null, text: "/orders" })).toBeNull();
    expect(sopLinkProblem({ ...link, targetType: "recipe_ingredient" })).toContain("recipe_ingredient");
  });
});

describe("supplier SOPs and station training", () => {
  it("never adds a supplier SOP to a station's training matrix", () => {
    const none = () => null;
    const facts = { checklistStation: none, recipeHasRawMeat: () => false, recipeIsMacCheese: () => false, ingredientStations: () => [] };
    expect(stationsForLink({ targetType: "supplier", targetA: 12, targetB: null, targetText: null }, facts as never)).toEqual([]);
  });
});
