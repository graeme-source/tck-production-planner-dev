import { describe, it, expect } from "vitest";
import { progressKey, dayOfKey, parseProgress, loadProgress, saveProgress, clearProgress, type SubRecipeProgress } from "./sub-recipe-progress";

function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; },
    map: m,
  };
}

const progress: SubRecipeProgress = { batches: 2, batchMultiplier: 2, customBatches: 1, stockOnHand: "1.5", checked: ["ing-4", "comp-9"] };

describe("sub-recipe progress (issue #378)", () => {
  it("keys by plan, London day and sub-recipe", () => {
    const k = progressKey(135, "2026-11-02", 59);
    expect(k).toBe("tck.subRecipeProgress.135.2026-11-02.59");
    expect(dayOfKey(k)).toBe("2026-11-02");
    expect(progressKey(null, "2026-11-02", 59)).toContain(".none.");
    expect(dayOfKey("something-else")).toBeNull();
  });

  it("survives a round trip so ticks come back after a sign-out", () => {
    const s = memStore();
    const k = progressKey(1, "2026-11-02", 59);
    saveProgress(s, k, progress);
    expect(loadProgress(s, k)).toEqual(progress);
  });

  it("keeps the 3x and 'exactly today's need' choices from the Replenish pop-up", () => {
    const exact = parseProgress(JSON.stringify({ ...progress, batches: 0.11, batchMultiplier: "exact" }));
    expect(exact?.batchMultiplier).toBe("exact");
    expect(exact?.batches).toBe(0.11);
    expect(parseProgress(JSON.stringify({ ...progress, batchMultiplier: 3 }))?.batchMultiplier).toBe(3);
  });

  it("drops progress saved on another day when saving", () => {
    const s = memStore();
    const old = progressKey(1, "2026-11-01", 59);
    saveProgress(s, old, progress);
    saveProgress(s, progressKey(1, "2026-11-02", 12), progress);
    expect(s.map.has(old)).toBe(false);
    s.map.set("unrelated", "x");
    saveProgress(s, progressKey(1, "2026-11-02", 13), progress);
    expect(s.map.has("unrelated")).toBe(true);
  });

  it("clears on Mark Complete / Start again", () => {
    const s = memStore();
    const k = progressKey(1, "2026-11-02", 59);
    saveProgress(s, k, progress);
    clearProgress(s, k);
    expect(loadProgress(s, k)).toBeNull();
  });

  it("ignores junk and missing storage", () => {
    expect(parseProgress("not json")).toBeNull();
    expect(parseProgress(JSON.stringify({ batches: 0 }))).toBeNull();
    expect(parseProgress(JSON.stringify({ batches: 1, checked: ["a", 3] }))?.checked).toEqual(["a"]);
    expect(loadProgress(null, "k")).toBeNull();
    expect(() => saveProgress(null, "k", progress)).not.toThrow();
    const broken = { ...memStore(), setItem: () => { throw new Error("full"); } };
    expect(() => saveProgress(broken, progressKey(1, "2026-11-02", 1), progress)).not.toThrow();
  });
});
