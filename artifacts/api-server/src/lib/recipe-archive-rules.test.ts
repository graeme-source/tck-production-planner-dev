import { describe, expect, it } from "vitest";
import { decideArchive } from "./recipe-archive-rules";

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
