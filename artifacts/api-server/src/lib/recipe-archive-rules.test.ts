import { describe, expect, it } from "vitest";
import { decideArchive, decideCreateStage, decideMenuTick, decideMoveToDraft, isOnMenu, recipeStage } from "./recipe-archive-rules";

const plain = { isCoreMenu: false, isCurrentSpecial: false };

describe("archiving core-menu / special recipes (2026-10-02)", () => {
  it("an ordinary recipe archives with nothing to untick", () => {
    expect(decideArchive(plain, false)).toEqual({ ok: true, clear: null });
  });
  it("a core-menu recipe is refused unless the person chose to untick it", () => {
    const d = decideArchive({ isCoreMenu: true, isCurrentSpecial: false }, false);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.message).toMatch(/core menu recipe/);
  });
  it("the special is refused too, naming both when both apply", () => {
    const d = decideArchive({ isCoreMenu: true, isCurrentSpecial: true }, false);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.message).toMatch(/core menu recipe and the current special/);
  });
  it("confirming unticks both as part of the archive", () => {
    expect(decideArchive({ isCoreMenu: true, isCurrentSpecial: true }, true)).toEqual({ ok: true, clear: { isCoreMenu: false, isCurrentSpecial: false } });
  });
});

describe("recipe stage (migration 0142)", () => {
  it("archived wins, then draft, else on the menu", () => {
    expect(recipeStage({ archivedAt: new Date(), isDraft: true })).toBe("archived");
    expect(recipeStage({ archivedAt: null, isDraft: true })).toBe("draft");
    expect(recipeStage({ archivedAt: null, isDraft: false })).toBe("active");
    expect(recipeStage({})).toBe("active");
  });
  it("only on-the-menu recipes are offered by production pickers", () => {
    expect(isOnMenu({ isDraft: true })).toBe(false);
    expect(isOnMenu({ archivedAt: "2026-10-02T09:00:00Z" })).toBe(false);
    expect(isOnMenu({ isDraft: false })).toBe(true);
  });
});

describe("moving a recipe to drafts", () => {
  it("an ordinary recipe moves with nothing to untick", () => {
    expect(decideMoveToDraft(plain, false)).toEqual({ ok: true, clear: null });
  });
  it("a core-menu or special recipe is refused until the person chooses to take it off the menu", () => {
    const d = decideMoveToDraft({ isCoreMenu: false, isCurrentSpecial: true }, false);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.message).toMatch(/current special.*a draft can't be on the menu/);
    expect(decideMoveToDraft({ isCoreMenu: true, isCurrentSpecial: false }, true)).toEqual({ ok: true, clear: { isCoreMenu: false, isCurrentSpecial: false } });
  });
});

describe("ticking Core menu / Special", () => {
  it("is fine on a recipe that's on the menu, and unticking a draft is fine", () => {
    expect(decideMenuTick(false, { isCoreMenu: true }, false)).toEqual({ ok: true, publish: false });
    expect(decideMenuTick(true, { isCoreMenu: false, isCurrentSpecial: false }, false)).toEqual({ ok: true, publish: false });
  });
  it("on a draft is refused unless the same save puts it on the menu", () => {
    const d = decideMenuTick(true, { isCoreMenu: true }, false);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.message).toMatch(/draft, so it can't be ticked Core menu/);
    expect(decideMenuTick(true, { isCurrentSpecial: true }, true)).toEqual({ ok: true, publish: true });
  });
});

describe("creating a recipe", () => {
  it("defaults to on the menu when the caller doesn't say (older clients)", () => {
    expect(decideCreateStage(undefined, plain)).toEqual({ ok: true, isDraft: false });
  });
  it("starts as a draft when asked", () => {
    expect(decideCreateStage(true, plain)).toEqual({ ok: true, isDraft: true });
  });
  it("refuses a draft that's ticked Core menu or Special", () => {
    expect(decideCreateStage(true, { isCoreMenu: true }).ok).toBe(false);
    expect(decideCreateStage(true, { isCurrentSpecial: true }).ok).toBe(false);
  });
});
