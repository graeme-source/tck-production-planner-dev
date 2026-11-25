import { describe, it, expect } from "vitest";
import {
  marinadeLineOf, marinadeLineKey, ticksByKey, withTick, visibleMarinadeRows,
  afterFailedTick, isDoubleTap, marinadeTicksFrom, tickIso, DOUBLE_TAP_MS, MARINADE_KEY_PREFIX,
  type MarinadeTick,
} from "./marinade-ticks";

const BEEF = 12;
const RECIPE = 5;
const salt = { rawMeatIngredientId: BEEF, marinadeIngredientId: 40, marinadeSubRecipeId: null, name: "Table Salt" };
const pepper = { rawMeatIngredientId: BEEF, marinadeIngredientId: 41, marinadeSubRecipeId: null, name: "Cracked Black Pepper" };
const confit = { rawMeatIngredientId: BEEF, marinadeIngredientId: null, marinadeSubRecipeId: 9, name: "Garlic Confit" };
const who = { userId: 3, userName: "Sam", tickedAt: "2026-11-25T08:00:00Z" };

function tick(row: Omit<typeof salt, "marinadeIngredientId" | "marinadeSubRecipeId"> & { marinadeIngredientId: number | null; marinadeSubRecipeId: number | null }, recipeId = RECIPE): MarinadeTick {
  return { key: marinadeLineKey(marinadeLineOf(recipeId, row)!), ...who };
}

describe("marinadeLineOf / marinadeLineKey", () => {
  it("keys an ingredient line and a sub-recipe line apart", () => {
    expect(marinadeLineKey(marinadeLineOf(RECIPE, salt)!)).toBe(`${MARINADE_KEY_PREFIX}5:12:i40`);
    expect(marinadeLineKey(marinadeLineOf(RECIPE, confit)!)).toBe(`${MARINADE_KEY_PREFIX}5:12:s9`);
  });

  it("an ingredient id and a sub-recipe id with the same number are different lines", () => {
    const a = marinadeLineOf(RECIPE, { rawMeatIngredientId: BEEF, marinadeIngredientId: 9, marinadeSubRecipeId: null })!;
    const b = marinadeLineOf(RECIPE, confit)!;
    expect(marinadeLineKey(a)).not.toBe(marinadeLineKey(b));
  });

  it("the same line in another recipe or under another meat is its own line", () => {
    expect(marinadeLineKey(marinadeLineOf(6, salt)!)).not.toBe(marinadeLineKey(marinadeLineOf(RECIPE, salt)!));
    expect(marinadeLineKey(marinadeLineOf(RECIPE, { ...salt, rawMeatIngredientId: 13 })!)).not.toBe(`${MARINADE_KEY_PREFIX}5:12:i40`);
  });

  it("can't key a row with neither or both ids", () => {
    expect(marinadeLineOf(RECIPE, { rawMeatIngredientId: BEEF, marinadeIngredientId: null, marinadeSubRecipeId: null })).toBeNull();
    expect(marinadeLineOf(RECIPE, { rawMeatIngredientId: BEEF, marinadeIngredientId: 1, marinadeSubRecipeId: 2 })).toBeNull();
  });
});

describe("withTick", () => {
  it("ticks a line on once, however many times it's tapped on", () => {
    const key = marinadeLineKey(marinadeLineOf(RECIPE, salt)!);
    const once = withTick([], key, true, who);
    const twice = withTick(once, key, true, who);
    expect(twice).toHaveLength(1);
    expect(twice[0].key).toBe(`${MARINADE_KEY_PREFIX}5:12:i40`);
  });

  it("ticks a line off and leaves the others", () => {
    const ticks = [tick(salt), tick(pepper)];
    const after = withTick(ticks, marinadeLineKey(marinadeLineOf(RECIPE, salt)!), false, who);
    expect(after.map(t => t.key)).toEqual([`${MARINADE_KEY_PREFIX}5:12:i41`]);
  });
});

describe("afterFailedTick", () => {
  it("takes a failed tick back off and keeps ticks made meanwhile", () => {
    const now = [tick(salt), tick(pepper)];
    expect(afterFailedTick(now, marinadeLineKey(marinadeLineOf(RECIPE, salt)!), null).map(t => t.key)).toEqual([`${MARINADE_KEY_PREFIX}5:12:i41`]);
  });

  it("puts a failed untick's old tick back, with who and when", () => {
    const was = tick(salt);
    expect(afterFailedTick([tick(pepper)], marinadeLineKey(marinadeLineOf(RECIPE, salt)!), was)).toContainEqual(was);
  });
});

describe("marinadeTicksFrom — shares the linked-tick table with Main Prep", () => {
  it("keeps only marinade keys and turns Postgres text into a real UTC time", () => {
    const rows = [
      { key: `${MARINADE_KEY_PREFIX}5:12:i40`, userId: 3, userName: "Sam", completedAt: "2026-11-25 13:05:45.303017" },
      { key: "pasta_water:123", userId: 3, userName: "Sam", completedAt: "2026-11-25 13:05:45" },
    ];
    expect(marinadeTicksFrom(rows)).toEqual([
      { key: `${MARINADE_KEY_PREFIX}5:12:i40`, userId: 3, userName: "Sam", tickedAt: "2026-11-25T13:05:45.303Z" },
    ]);
  });
  it("leaves a time that already has a zone alone", () => {
    expect(tickIso("2026-11-25T13:05:45.000Z")).toBe("2026-11-25T13:05:45.000Z");
    expect(tickIso("2026-11-25 13:05:45+00")).toBe("2026-11-25T13:05:45.000Z");
  });
});

describe("isDoubleTap", () => {
  it("ignores a second tap right after the first, not a deliberate next one", () => {
    expect(isDoubleTap(null, 1000)).toBe(false);
    expect(isDoubleTap(1000, 1000 + DOUBLE_TAP_MS - 1)).toBe(true);
    expect(isDoubleTap(1000, 1000 + DOUBLE_TAP_MS)).toBe(false);
  });
});

describe("visibleMarinadeRows", () => {
  const rows = [salt, pepper, confit];

  it("hides ticked rows while hide-done is on, in the original order", () => {
    const v = visibleMarinadeRows(RECIPE, rows, ticksByKey([tick(pepper)]), false);
    expect(v.visible.map(x => x.row.name)).toEqual(["Table Salt", "Garlic Confit"]);
    expect(v.doneCount).toBe(1);
    expect(v.total).toBe(3);
  });

  it("shows every row, ticked ones marked, when show-done is on", () => {
    const v = visibleMarinadeRows(RECIPE, rows, ticksByKey([tick(pepper), tick(confit)]), true);
    expect(v.visible.map(x => [x.row.name, x.tick != null])).toEqual([
      ["Table Salt", false], ["Cracked Black Pepper", true], ["Garlic Confit", true],
    ]);
    expect(v.doneCount).toBe(2);
  });

  it("all ticked and hidden leaves nothing showing but still counts them", () => {
    const v = visibleMarinadeRows(RECIPE, rows, ticksByKey(rows.map(r => tick(r))), false);
    expect(v.visible).toEqual([]);
    expect(v.doneCount).toBe(3);
  });

  it("a tick from another recipe doesn't tick this recipe's line", () => {
    const v = visibleMarinadeRows(RECIPE, rows, ticksByKey([tick(salt, 6)]), false);
    expect(v.doneCount).toBe(0);
    expect(v.visible).toHaveLength(3);
  });

  it("a row that can't be keyed always shows and is never done", () => {
    const odd = { rawMeatIngredientId: BEEF, marinadeIngredientId: null, marinadeSubRecipeId: null, name: "Unknown" };
    const v = visibleMarinadeRows(RECIPE, [odd], new Map(), false);
    expect(v.visible).toHaveLength(1);
    expect(v.visible[0].key).toBeNull();
    expect(v.doneCount).toBe(0);
  });
});
