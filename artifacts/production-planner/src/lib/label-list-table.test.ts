import { describe, expect, it } from "vitest";
import { DEFAULT_LABEL_SORT, labelTodo, matchesLabelSearch, sortLabelRows, type LabelTableRow } from "./label-list-table";

const label = (name: string, status: LabelTableRow["status"], extra: Partial<LabelTableRow> = {}): LabelTableRow => ({
  name, category: null, status, liveVersion: null, changes: [], blockers: [], ...extra,
});

describe("Product Labels table", () => {
  it("defaults to attention first — doesn't fit, update needed, never published, live — then name", () => {
    const rows = [
      label("Zed", "live"), label("Beta", "never-published"), label("Alpha", "live"),
      label("Gamma", "update-needed"), label("Delta", "doesnt-fit"), label("Draft one", "draft-recipe"),
      label("Abc", "update-needed"),
    ];
    expect(sortLabelRows(rows, DEFAULT_LABEL_SORT).map(r => r.name))
      .toEqual(["Delta", "Abc", "Gamma", "Beta", "Alpha", "Zed", "Draft one"]);
  });
  it("sorts by live version date with never-published at the bottom", () => {
    const rows = [
      label("Old", "live", { liveVersion: { versionNo: 1, publishedAt: "2026-09-01T10:00:00Z", publishedByName: null } }),
      label("None", "never-published"),
      label("New", "live", { liveVersion: { versionNo: 3, publishedAt: "2026-10-10T10:00:00Z", publishedByName: null } }),
    ];
    expect(sortLabelRows(rows, { key: "live", dir: "desc" }).map(r => r.name)).toEqual(["New", "Old", "None"]);
    expect(sortLabelRows(rows, { key: "live", dir: "asc" }).map(r => r.name)).toEqual(["Old", "New", "None"]);
  });
  it("summarises what needs doing, short for the cell and in full for hover", () => {
    const r = label("X", "update-needed", { changes: ["a", "b", "c", "d", "e"] });
    expect(labelTodo(r).short).toBe("Changed since live: a, b, c +2 more");
    expect(labelTodo(r).full).toBe("Changed since live: a, b, c, d, e");
    const blocked = label("Y", "never-published", { blockers: ["No barcode number yet"] });
    expect(labelTodo(blocked).short).toBe("No barcode number yet");
    const many = label("Z", "doesnt-fit", { blockers: ["one", "two"] });
    expect(labelTodo(many)).toEqual({ short: "2 things to fix before it can go live", full: "one\ntwo" });
    expect(labelTodo(label("L", "live", { blockers: ["ignored once live"] })).short).toBe("");
  });
  it("searches name and category", () => {
    const r = label("Chicken Pie", "live", { category: "Calzone" });
    expect(matchesLabelSearch(r, "  pie ")).toBe(true);
    expect(matchesLabelSearch(r, "calz")).toBe(true);
    expect(matchesLabelSearch(r, "beef")).toBe(false);
    expect(matchesLabelSearch(r, "")).toBe(true);
  });
});

