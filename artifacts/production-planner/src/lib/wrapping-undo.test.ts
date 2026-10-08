import { describe, it, expect } from "vitest";
import {
  summariseTakeBackOut,
  reasonReady,
  takeBackOutBody,
  holdProgress,
  UNDO_REASON_OPTIONS,
  HOLD_TO_CONFIRM_MS,
} from "./wrapping-undo";

describe("summariseTakeBackOut — what the confirmation says", () => {
  // 8 Oct 2026: Philly Cheesesteak net 73, 20 in the fridge, "Undo 20".
  const philly = {
    recipeName: "Philly Cheesesteak 2.0",
    qty: 20,
    packSize: 2 as const,
    where: "fridge" as const,
    storedBefore: 20,
    target: 73,
    otherStored: 0,
  };

  it("names the packs, recipe and place", () => {
    const s = summariseTakeBackOut(philly);
    expect(s.question).toBe("Take 20 packs of Philly Cheesesteak 2.0 back OUT of the fridge?");
    expect(s.holdLabel).toBe("Hold to take 20 packs out");
  });

  it("shows fridge and still-to-wrap before → after", () => {
    const s = summariseTakeBackOut(philly);
    expect([s.storedBefore, s.storedAfter]).toEqual([20, 0]);
    expect([s.stillToWrapBefore, s.stillToWrapAfter]).toEqual([53, 73]);
  });

  it("never offers to take out more than the record holds", () => {
    const s = summariseTakeBackOut({ ...philly, qty: 24, storedBefore: 6 });
    expect(s.qty).toBe(6);
    expect(s.storedAfter).toBe(0);
  });

  it("counts the other place towards still-to-wrap", () => {
    const s = summariseTakeBackOut({ ...philly, where: "freezer", storedBefore: 10, qty: 10, otherStored: 50 });
    expect(s.question).toContain("the freezer");
    expect([s.stillToWrapBefore, s.stillToWrapAfter]).toEqual([13, 23]);
  });

  it("over-wrapped never shows a negative still-to-wrap", () => {
    const s = summariseTakeBackOut({ ...philly, storedBefore: 80, qty: 5 });
    expect([s.stillToWrapBefore, s.stillToWrapAfter]).toEqual([0, 0]);
  });

  it("says bag / bags for 8-packs, and falls back when the name is missing", () => {
    const one = summariseTakeBackOut({ ...philly, packSize: 8, qty: 1, storedBefore: 3, target: 5, recipeName: null });
    expect(one.question).toBe("Take 1 8-pack bag of this recipe back OUT of the fridge?");
    expect([one.stillToWrapBefore, one.stillToWrapAfter]).toEqual([2, 3]);
    const pack = summariseTakeBackOut({ ...philly, qty: 1, storedBefore: 1 });
    expect(pack.unit).toBe("pack");
  });
});

describe("reasonReady", () => {
  it("needs a reason, and words for Other", () => {
    expect(reasonReady(null, "")).toBe(false);
    expect(reasonReady("added_twice", "")).toBe(true);
    expect(reasonReady("other", "   ")).toBe(false);
    expect(reasonReady("other", "bag split")).toBe(true);
  });
});

describe("takeBackOutBody — the only shape the server accepts", () => {
  it("always carries confirm: true and the reason", () => {
    expect(takeBackOutBody({ qty: 20, packSize: 2, reason: "added_twice" }))
      .toEqual({ qty: 20, packSize: 2, confirm: true, reason: "added_twice" });
  });
  it("sends Other's words trimmed, and drops them for any other reason", () => {
    expect(takeBackOutBody({ qty: 1, packSize: 8, reason: "other", otherText: "  bag split " }).otherText).toBe("bag split");
    expect(takeBackOutBody({ qty: 1, packSize: 8, reason: "wrong_recipe", otherText: "x" }).otherText).toBeUndefined();
  });
});

describe("holdProgress", () => {
  it("fills over the hold time and stops at 1", () => {
    expect(holdProgress(0)).toBe(0);
    expect(holdProgress(-5)).toBe(0);
    expect(holdProgress(HOLD_TO_CONFIRM_MS / 2)).toBeCloseTo(0.5);
    expect(holdProgress(HOLD_TO_CONFIRM_MS * 3)).toBe(1);
  });
  it("is 1.5 seconds", () => {
    expect(HOLD_TO_CONFIRM_MS).toBe(1500);
  });
});

describe("reason list", () => {
  it("matches the server's codes", () => {
    expect(UNDO_REASON_OPTIONS.map(o => o.code)).toEqual(["added_twice", "wrong_recipe", "not_wrapped", "other"]);
  });
});
