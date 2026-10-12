import { describe, expect, it } from "vitest";
import { declarationIssues } from "@workspace/allergens";
import { DECLARATION_DEPENDENT_KEYS, issueGroups, otherBlockers, rowsToDeclarationItems } from "./declaration-fix";

// Garlic Cheese on 12 Oct: one missing, one unwrapped.
const issues = declarationIssues([
  { ingredientId: 9, name: "Grated Mature White Cheddar Cheese", labelDeclaration: null },
  { ingredientId: 65, name: "Salted Butter", labelDeclaration: "Butter (MILK), Salt" },
]);

describe("check → fix flow", () => {
  it("groups the check's lines with what to do, each ingredient a fix button", () => {
    const g = issueGroups(issues);
    expect(g.map(x => x.kind)).toEqual(["missing", "unwrapped"]);
    expect(g[0].title).toBe("1 ingredient has no label declaration");
    expect(g[0].items[0].ingredientId).toBe(9);
    expect(g[1].items[0]).toEqual({ kind: "unwrapped", ingredientId: 65, name: "Salted Butter" });
    expect(g[1].help).toMatch(/press Save/);
  });

  it("shows nothing when there is nothing to fix", () => {
    expect(issueGroups([])).toEqual([]);
  });

  it("drops the deck's plain-text blockers in favour of the buttons, keeping the rest", () => {
    const deck = ["1 ingredient(s) have no label declaration: X.", "Declaration needs its compound name around the list: Y."];
    const all = ["The label doesn't fit.", ...deck];
    expect(otherBlockers(all, deck, issues)).toEqual(["The label doesn't fit."]);
    // An older server without deckIssues: keep the text so nothing is hidden.
    expect(otherBlockers(all, deck, undefined)).toEqual(all);
  });

  it("re-runs every check that depends on a declaration after a fix", () => {
    expect(DECLARATION_DEPENDENT_KEYS).toContainEqual(["product-labels"]);
    expect(DECLARATION_DEPENDENT_KEYS).toContainEqual(["recipe-ingredient-deck"]);
    expect(DECLARATION_DEPENDENT_KEYS).toContainEqual(["sub-recipe-label-usage"]);
  });

  it("finds a sub-recipe's own rows' issues from the ingredient list", () => {
    const items = rowsToDeclarationItems(
      [{ ingredientId: "65" }, { ingredientId: 3 }, { ingredientId: 999 }],
      [{ id: 65, name: "Salted Butter", labelDeclaration: null }, { id: 3, name: "Salt", labelDeclaration: "Salt" }],
    );
    expect(declarationIssues(items)).toEqual([{ kind: "missing", ingredientId: 65, name: "Salted Butter" }]);
  });
});
