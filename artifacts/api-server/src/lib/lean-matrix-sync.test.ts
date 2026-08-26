import { describe, it, expect } from "vitest";
import {
  matrixLabelFor,
  planMatrixSync,
  isNoopPlan,
  type CurriculumWeek,
  type MatrixItemRow,
} from "./lean-matrix-sync";

const week = (principleId: number, title: string, position: number, partLabel: string | null = null): CurriculumWeek =>
  ({ principleId, title, position, partLabel });

const item = (
  id: number,
  label: string,
  principleId: number | null,
  sortOrder: number,
  hasSignOffs = false,
): MatrixItemRow => ({ id, label, principleId, sortOrder, hasSignOffs });

describe("matrixLabelFor", () => {
  it("uses the bare title for a subject's own week", () => {
    expect(matrixLabelFor({ title: "3S", partLabel: null })).toBe("3S");
  });

  it("appends the part for a split subject", () => {
    expect(matrixLabelFor({ title: "3S", partLabel: "Sweep" })).toBe("3S — Sweep");
  });

  it("treats a blank part as no part", () => {
    expect(matrixLabelFor({ title: "3S", partLabel: "   " })).toBe("3S");
  });
});

describe("planMatrixSync", () => {
  it("creates a column for every week when the matrix is empty", () => {
    const plan = planMatrixSync([week(1, "Seeing Waste", 1), week(2, "Overproduction", 2)], []);
    expect(plan.create).toEqual([
      { principleId: 1, label: "Seeing Waste", sortOrder: 1 },
      { principleId: 2, label: "Overproduction", sortOrder: 2 },
    ]);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it("does nothing when the matrix already matches", () => {
    const weeks = [week(1, "Seeing Waste", 1), week(2, "Overproduction", 2)];
    const items = [item(10, "Seeing Waste", 1, 1), item(11, "Overproduction", 2, 2)];
    expect(isNoopPlan(planMatrixSync(weeks, items))).toBe(true);
  });

  it("renames a column when its week is retitled, keeping the same row", () => {
    const plan = planMatrixSync([week(1, "Seeing Waste — What Waste Is", 1)], [item(10, "Seeing Waste", 1, 1)]);
    expect(plan.update).toEqual([{ id: 10, label: "Seeing Waste — What Waste Is", sortOrder: 1 }]);
    expect(plan.remove).toEqual([]);
    expect(plan.create).toEqual([]);
  });

  it("re-sorts columns when the plan is re-ordered", () => {
    // Weeks swapped: Overproduction now runs first.
    const weeks = [week(2, "Overproduction", 1), week(1, "Seeing Waste", 2)];
    const items = [item(10, "Seeing Waste", 1, 1), item(11, "Overproduction", 2, 2)];
    const plan = planMatrixSync(weeks, items);
    expect(plan.update).toEqual([
      { id: 11, label: "Overproduction", sortOrder: 1 },
      { id: 10, label: "Seeing Waste", sortOrder: 2 },
    ]);
  });

  it("removes a column whose week left the plan and which nobody was signed off on", () => {
    const plan = planMatrixSync([week(1, "Seeing Waste", 1)], [
      item(10, "Seeing Waste", 1, 1),
      item(11, "Example Area", 2, 2, false),
    ]);
    expect(plan.remove).toEqual([11]);
    expect(plan.keepAsHistory).toEqual([]);
  });

  it("keeps a dropped column that carries sign-offs, rather than destroying the evidence", () => {
    const plan = planMatrixSync([week(1, "Seeing Waste", 1)], [
      item(10, "Seeing Waste", 1, 1),
      item(11, "Example Area", 2, 2, true),
    ]);
    expect(plan.remove).toEqual([]);
    expect(plan.keepAsHistory).toEqual([11]);
  });

  it("never touches hand-made columns that aren't tied to a week", () => {
    const plan = planMatrixSync([week(1, "Seeing Waste", 1)], [
      item(10, "Seeing Waste", 1, 1),
      item(99, "Fire marshal briefing", null, 2, false),
    ]);
    expect(plan.remove).toEqual([]);
    expect(plan.keepAsHistory).toEqual([]);
    expect(plan.update).toEqual([]);
  });

  it("converges on one column when an old seeder left duplicates for a week", () => {
    const plan = planMatrixSync([week(1, "Seeing Waste", 1)], [
      item(10, "Seeing Waste", 1, 1),
      item(12, "Seeing Waste", 1, 2, false),
    ]);
    // Lowest id is kept and kept in place; the duplicate is dropped.
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([12]);
  });

  it("labels split weeks with their part names", () => {
    const plan = planMatrixSync(
      [week(1, "3S", 1), week(2, "3S", 2, "Sweep"), week(3, "3S", 3, "Sort")],
      [],
    );
    expect(plan.create.map(c => c.label)).toEqual(["3S", "3S — Sweep", "3S — Sort"]);
  });

  it("orders by position, not by the order weeks arrive in", () => {
    const plan = planMatrixSync([week(2, "Second", 2), week(1, "First", 1)], []);
    expect(plan.create.map(c => c.label)).toEqual(["First", "Second"]);
  });
});
