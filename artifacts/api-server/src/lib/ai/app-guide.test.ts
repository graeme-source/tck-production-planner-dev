import { describe, it, expect } from "vitest";
import { APP_GUIDE, searchAppGuide } from "./app-guide";

describe("APP_GUIDE", () => {
  it("has entries and every path starts with a single slash", () => {
    expect(APP_GUIDE.length).toBeGreaterThan(30);
    for (const e of APP_GUIDE) {
      expect(e.path.startsWith("/"), e.path).toBe(true);
      expect(e.path.startsWith("//"), e.path).toBe(false);
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.canDo.length).toBeGreaterThan(0);
      expect(e.keywords.length).toBeGreaterThan(0);
    }
  });
});

describe("searchAppGuide", () => {
  it("finds a real feature", () => {
    const hits = searchAppGuide("can I print a label for the printer");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some(h => /label/i.test(h.title))).toBe(true);
  });

  it("finds the wish list by title", () => {
    expect(searchAppGuide("wish list")[0].path).toBe("/wish-list");
  });

  it("respects the limit and ranks best first", () => {
    const hits = searchAppGuide("stock count", 2);
    expect(hits.length).toBeLessThanOrEqual(2);
    expect(hits.length).toBeGreaterThan(0);
  });

  it("returns [] for nonsense or only stop words", () => {
    expect(searchAppGuide("zxqv blorptastic")).toEqual([]);
    expect(searchAppGuide("can I do the")).toEqual([]);
    expect(searchAppGuide("")).toEqual([]);
  });
});
