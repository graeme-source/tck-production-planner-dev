import { describe, it, expect } from "vitest";
import { parseMinShelfDaysRules, minShelfDaysFor, BUILT_IN_MIN_SHELF_RULES } from "./min-shelf-days";

describe("parseMinShelfDaysRules", () => {
  it("falls back to the long-standing 3/2 rule when the setting is absent", () => {
    expect(parseMinShelfDaysRules(null)).toEqual(BUILT_IN_MIN_SHELF_RULES);
    expect(parseMinShelfDaysRules(undefined)).toEqual(BUILT_IN_MIN_SHELF_RULES);
    expect(parseMinShelfDaysRules("")).toEqual(BUILT_IN_MIN_SHELF_RULES);
  });

  it("falls back to the built-in rule on garbage, never to no rule", () => {
    expect(parseMinShelfDaysRules("not json")).toEqual(BUILT_IN_MIN_SHELF_RULES);
    expect(parseMinShelfDaysRules('{"default":"lots"}')).toEqual(BUILT_IN_MIN_SHELF_RULES);
    expect(parseMinShelfDaysRules('{"default":-1}')).toEqual(BUILT_IN_MIN_SHELF_RULES);
    expect(parseMinShelfDaysRules('{"default":99}')).toEqual(BUILT_IN_MIN_SHELF_RULES);
  });

  it("reads a configured rule and lowercases the categories", () => {
    const rules = parseMinShelfDaysRules('{"default":4,"byCategory":{"Macaroni Cheese":2,"calzone":3}}');
    expect(rules.default).toBe(4);
    expect(rules.byCategory).toEqual({ "macaroni cheese": 2, calzone: 3 });
  });

  it("drops malformed category entries but keeps the good ones", () => {
    const rules = parseMinShelfDaysRules('{"default":3,"byCategory":{"macaroni cheese":"soon","calzone":2,"":5}}');
    expect(rules.byCategory).toEqual({ calzone: 2 });
  });
});

describe("minShelfDaysFor", () => {
  it("reproduces the historical behaviour under the built-in rules", () => {
    // Graeme's worked example (2026-09-02): dispatch on the 2nd → delivery
    // the 3rd → calzone use-by must be ≥ 6th (3 days), mac cheese ≥ 5th (2).
    expect(minShelfDaysFor("Calzone", BUILT_IN_MIN_SHELF_RULES)).toBe(3);
    expect(minShelfDaysFor("Macaroni Cheese", BUILT_IN_MIN_SHELF_RULES)).toBe(2);
    expect(minShelfDaysFor("macaroni cheese", BUILT_IN_MIN_SHELF_RULES)).toBe(2);
    expect(minShelfDaysFor(null, BUILT_IN_MIN_SHELF_RULES)).toBe(3);
    expect(minShelfDaysFor("Desserts", BUILT_IN_MIN_SHELF_RULES)).toBe(3);
  });

  it("honours configured overrides case-insensitively", () => {
    const rules = { default: 5, byCategory: { "macaroni cheese": 1 } };
    expect(minShelfDaysFor("MACARONI CHEESE", rules)).toBe(1);
    expect(minShelfDaysFor("Calzone", rules)).toBe(5);
  });
});
