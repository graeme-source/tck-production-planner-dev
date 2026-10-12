import { describe, expect, it } from "vitest";
import { searchForTab, tabFromSearch } from "./tab-param";

const TABS = ["label", "deck", "nutrition"] as const;

describe("tabFromSearch", () => {
  it("defaults to the first tab", () => {
    expect(tabFromSearch("", TABS)).toBe("label");
  });
  it("reads ?tab=", () => {
    expect(tabFromSearch("tab=deck", TABS)).toBe("deck");
    expect(tabFromSearch("?x=1&tab=nutrition", TABS)).toBe("nutrition");
  });
  it("ignores a tab this page doesn't have (or the viewer can't see)", () => {
    expect(tabFromSearch("tab=health", TABS)).toBe("label");
    expect(tabFromSearch("tab=deck", ["label"] as const)).toBe("label");
  });
});

describe("searchForTab", () => {
  it("drops ?tab for the default tab", () => {
    expect(searchForTab("tab=deck", "label", TABS)).toBe("");
  });
  it("sets ?tab and keeps other parameters", () => {
    expect(searchForTab("x=1", "deck", TABS)).toBe("?x=1&tab=deck");
    expect(searchForTab("tab=deck&x=1", "nutrition", TABS)).toBe("?tab=nutrition&x=1");
  });
});
