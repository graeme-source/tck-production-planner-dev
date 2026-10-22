import { describe, it, expect } from "vitest";
import { pgErrorCode, ingredientInUseMessage } from "./ingredient-in-use";

// #326: the friendly "still in use" message never showed for Jane.
describe("pgErrorCode", () => {
  it("finds the code at the top, one level down, or deeper", () => {
    expect(pgErrorCode({ code: "23503" })).toBe("23503");
    expect(pgErrorCode({ message: "x", cause: { code: "23503" } })).toBe("23503");
    expect(pgErrorCode(new Error("Failed query", { cause: new Error("wrap", { cause: Object.assign(new Error("fk"), { code: "23503" }) }) }))).toBe("23503");
  });
  it("ignores non-Postgres codes and plain errors", () => {
    expect(pgErrorCode(Object.assign(new Error("net"), { code: "ECONNRESET" }))).toBeNull();
    expect(pgErrorCode(new Error("boom"))).toBeNull();
    expect(pgErrorCode(null)).toBeNull();
  });
});

describe("ingredientInUseMessage", () => {
  const none = { recipeNames: [], subRecipeNames: [], purchaseOrderLines: 0, stockRecords: 0, prepRecords: 0, kanbanItems: 0 };
  it("history (orders, stock, kanban) advises asking a manager to merge", () => {
    const m = ingredientInUseMessage("Mixed Herbs", { ...none, purchaseOrderLines: 3, stockRecords: 3, kanbanItems: 1 });
    expect(m).toContain("3 purchase-order lines · 3 stock records · 1 kanban item");
    expect(m).toContain("ask a manager to merge it into the other one");
    expect(m).not.toContain("inactive");
  });
  it("recipe use asks to remove it from those recipes first", () => {
    const m = ingredientInUseMessage("Oregano", { ...none, recipeNames: ["Margherita"] });
    expect(m).toContain("recipes: Margherita");
    expect(m).toContain("Remove it from those recipes first.");
    expect(m).not.toContain("merge");
  });
});
