import { describe, it, expect } from "vitest";
import { parseCommitMessage, isThemeEditorSave, isMergeCommit, categoriseThemeChange, countsForLeadHistory } from "./changes";

describe("parseCommitMessage", () => {
  it("keeps the subject and body, drops git trailers", () => {
    const r = parseCommitMessage(
      "Announcement bar: free pack offer now ends Friday\n\nWhy: offer moved.\n\nCo-Authored-By: Claude <x@y>\nClaude-Session: https://a/b",
    );
    expect(r.title).toBe("Announcement bar: free pack offer now ends Friday");
    expect(r.detail).toBe("Why: offer moved.");
  });
  it("returns null detail for a subject-only commit", () => {
    expect(parseCommitMessage("Update from Shopify for theme tck-theme/main").detail).toBeNull();
  });
});

describe("commit kinds", () => {
  it("spots theme-editor saves and merges", () => {
    expect(isThemeEditorSave("Update from Shopify for theme tck-theme/main")).toBe(true);
    expect(isThemeEditorSave("Homepage hero: new badge")).toBe(false);
    expect(isMergeCommit("Merge branch 'sub-minimum-guard' into main")).toBe(true);
  });
});

describe("categoriseThemeChange", () => {
  it("files offers, delivery and plain theme changes", () => {
    expect(categoriseThemeChange("Announcement bar: Autumn Free Pack wording", [])).toBe("offer");
    expect(categoriseThemeChange("Cart: delivery-date pop-up", [])).toBe("delivery");
    expect(categoriseThemeChange("Homepage hero: bigger heading", [])).toBe("theme");
    expect(categoriseThemeChange("Update from Shopify", ["config/settings_data.json"])).toBe("offer");
  });
});

describe("countsForLeadHistory", () => {
  it("drops cancelled, subscription renewals and wholesale", () => {
    expect(countsForLeadHistory(["2026-10-14", "new-customer"], false)).toBe(true);
    expect(countsForLeadHistory(["2026-10-14"], true)).toBe(false);
    expect(countsForLeadHistory(["Subscription Recurring Order", "2026-10-14"], false)).toBe(false);
    expect(countsForLeadHistory([" Wholesale "], false)).toBe(false);
  });
});
