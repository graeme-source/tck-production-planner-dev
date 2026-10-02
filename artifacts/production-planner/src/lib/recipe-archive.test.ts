import { describe, expect, it } from "vitest";
import { activeRecipes, archivedLabel, archivedRecipeIds, archivedRecipes, archiveWarnings, draftedLabel, draftMenuQuestion, draftMenuTickNotice, draftRecipeIds, draftRecipes, isArchived, isDraftRecipe, menuFlagQuestion, notArchivedRecipes, planDayPhrase, recipeStage, recipeStageCounts } from "./recipe-archive";

const list = [
  { id: 1, name: "Philly", archivedAt: null },
  { id: 2, name: "Old Pepperoni", archivedAt: "2026-10-02T09:00:00.000Z" },
  { id: 3, name: "Meatball" },
];

describe("isArchived", () => {
  it("treats null, undefined and empty as active", () => {
    expect(isArchived({ archivedAt: null })).toBe(false);
    expect(isArchived({})).toBe(false);
    expect(isArchived({ archivedAt: "" })).toBe(false);
    expect(isArchived(undefined)).toBe(false);
    expect(isArchived({ archivedAt: "2026-10-02T09:00:00Z" })).toBe(true);
  });
});

describe("activeRecipes / archivedRecipes", () => {
  it("hides archived recipes from pickers", () => {
    expect(activeRecipes(list).map(r => r.id)).toEqual([1, 3]);
    expect(archivedRecipes(list).map(r => r.id)).toEqual([2]);
    expect([...archivedRecipeIds(list)]).toEqual([2]);
  });
  it("keeps an archived recipe that is already chosen, so a saved selection never goes blank", () => {
    expect(activeRecipes(list, [2]).map(r => r.id)).toEqual([1, 2, 3]);
    expect(activeRecipes(list, [null, undefined]).map(r => r.id)).toEqual([1, 3]);
  });
  it("copes with no data yet", () => {
    expect(activeRecipes(undefined)).toEqual([]);
    expect(archivedRecipes(null)).toEqual([]);
  });
});

describe("recipe stages: draft → on the menu → archived (migration 0142)", () => {
  const mixed = [
    { id: 1, name: "Philly", archivedAt: null, isDraft: false },
    { id: 2, name: "Old Pepperoni", archivedAt: "2026-10-02T09:00:00.000Z", isDraft: false },
    { id: 3, name: "Meatball" },
    { id: 4, name: "Piri Piri (DRAFT)", archivedAt: null, isDraft: true },
    { id: 5, name: "Abandoned idea", archivedAt: "2026-10-01T09:00:00.000Z", isDraft: true },
  ];
  it("stage = archived if archivedAt, else draft if isDraft, else active", () => {
    expect(mixed.map(r => recipeStage(r))).toEqual(["active", "archived", "active", "draft", "archived"]);
    expect(isDraftRecipe(mixed[3])).toBe(true);
    expect(isDraftRecipe(mixed[4])).toBe(false);
    expect(recipeStage(undefined)).toBe("active");
  });
  it("production pickers hide drafts exactly as they hide archived recipes", () => {
    expect(activeRecipes(mixed).map(r => r.id)).toEqual([1, 3]);
  });
  it("keeps a draft (or archived recipe) that's already chosen, so a saved selection never goes blank", () => {
    expect(activeRecipes(mixed, [4]).map(r => r.id)).toEqual([1, 3, 4]);
    expect(activeRecipes(mixed, [5, null]).map(r => r.id)).toEqual([1, 3, 5]);
  });
  it("development tools (test boxes, Product Hub, P&L) include drafts but never archived", () => {
    expect(notArchivedRecipes(mixed).map(r => r.id)).toEqual([1, 3, 4]);
    expect(notArchivedRecipes(mixed, [2]).map(r => r.id)).toEqual([1, 2, 3, 4]);
  });
  it("the Recipes page views and counts", () => {
    expect(draftRecipes(mixed).map(r => r.id)).toEqual([4]);
    expect(archivedRecipes(mixed).map(r => r.id)).toEqual([2, 5]);
    expect(recipeStageCounts(mixed)).toEqual({ draft: 1, active: 2, archived: 2 });
    expect([...draftRecipeIds(mixed)]).toEqual([4]);
  });
  it("asks before moving a core-menu / special recipe to drafts", () => {
    expect(draftMenuQuestion({ isCoreMenu: false, isCurrentSpecial: false })).toBeNull();
    const q = draftMenuQuestion({ isCoreMenu: true })!;
    expect(q.confirmLabel).toBe("Take it off the menu and make it a draft");
    expect(q.message).toMatch(/core menu recipe\. A draft can't be on the menu/);
    expect(draftMenuQuestion({ isCurrentSpecial: true })!.message).toMatch(/won't re-tick it as the special or replace whatever is the special/);
  });
  it("warns in Edit Recipe that ticking Core menu / Special on a draft puts it on the menu", () => {
    expect(draftMenuTickNotice(false, { isCoreMenu: true })).toBeNull();
    expect(draftMenuTickNotice(true, {})).toBeNull();
    expect(draftMenuTickNotice(true, { isCoreMenu: true })).toMatch(/draft\. Core menu is ticked, so saving puts it on the menu/);
    expect(draftMenuTickNotice(true, { isCoreMenu: true, isCurrentSpecial: true })).toMatch(/Core menu and Special are ticked/);
  });
});

describe("draftedLabel", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  it("reads 'Draft since 2 Oct (Graeme)', London day, first name only", () => {
    expect(draftedLabel("2026-10-01T23:30:00.000Z", "Graeme Carter", now)).toBe("Draft since 2 Oct (Graeme)");
  });
  it("is just 'Draft' when we don't know when", () => {
    expect(draftedLabel(null, null, now)).toBe("Draft");
    expect(draftedLabel("2026-10-02T09:00:00Z", null, now)).toBe("Draft since 2 Oct");
  });
});

describe("archivedLabel", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  it("reads 'Archived 2 Oct by Graeme' with the first name only", () => {
    expect(archivedLabel("2026-10-02T09:00:00.000Z", "Graeme Carter", now)).toBe("Archived 2 Oct by Graeme");
  });
  it("uses the London day, not UTC (late-evening BST archive)", () => {
    expect(archivedLabel("2026-10-01T23:30:00.000Z", "Graeme", now)).toBe("Archived 2 Oct by Graeme");
  });
  it("adds the year when it isn't this year, and drops 'by' when the name is unknown", () => {
    expect(archivedLabel("2025-03-14T12:00:00Z", null, now)).toBe("Archived 14 Mar 2025");
  });
  it("is empty for an active recipe", () => {
    expect(archivedLabel(null, "Graeme", now)).toBe("");
  });
});

describe("planDayPhrase", () => {
  const today = "2026-10-02"; // a Friday
  it("names today, tomorrow and days this week", () => {
    expect(planDayPhrase("2026-10-02", today)).toBe("today's plan");
    expect(planDayPhrase("2026-10-03", today)).toBe("tomorrow's plan");
    expect(planDayPhrase("2026-10-05", today)).toBe("Monday's plan");
    expect(planDayPhrase("2026-10-08", today)).toBe("Thursday's plan");
  });
  it("uses the date a week or more out", () => {
    expect(planDayPhrase("2026-10-09", today)).toBe("the plan for 9 Oct");
  });
});

describe("archiveWarnings", () => {
  const today = "2026-09-30"; // a Wednesday
  it("says nothing for a recipe that is not planned or flagged", () => {
    expect(archiveWarnings({ upcomingPlans: [] }, today)).toEqual([]);
  });
  it("warns, without blocking, when it's on an upcoming plan", () => {
    expect(archiveWarnings({ upcomingPlans: [{ planDate: "2026-10-02" }] }, today)).toEqual([
      "It's on Friday's plan — it'll still be made; it just won't be offered for new plans.",
    ]);
  });
  it("lists several plan days once each, in order", () => {
    const w = archiveWarnings({ upcomingPlans: [{ planDate: "2026-10-02" }, { planDate: "2026-09-30" }, { planDate: "2026-10-02" }] }, today);
    expect(w[0]).toBe("It's on today's plan and Friday's plan — it'll still be made; it just won't be offered for new plans.");
  });
  it("summarises beyond three plan days", () => {
    const w = archiveWarnings({ upcomingPlans: ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06"].map(planDate => ({ planDate })) }, today);
    expect(w[0]).toBe("It's on today's plan, tomorrow's plan, Friday's plan and 2 more — it'll still be made; it just won't be offered for new plans.");
  });
  it("core menu / special are a question, not a warning (2026-10-02)", () => {
    expect(archiveWarnings({ upcomingPlans: [], isCoreMenu: true, isCurrentSpecial: true }, today)).toHaveLength(0);
    expect(menuFlagQuestion({ isCoreMenu: false, isCurrentSpecial: false })).toBeNull();
    expect(menuFlagQuestion({ isCoreMenu: true })!.confirmLabel).toBe("Untick core menu and archive");
    const both = menuFlagQuestion({ isCoreMenu: true, isCurrentSpecial: true })!;
    expect(both.message).toMatch(/core menu recipe and the current special/);
    expect(both.message).toMatch(/won't replace whatever is the special/);
  });
});
