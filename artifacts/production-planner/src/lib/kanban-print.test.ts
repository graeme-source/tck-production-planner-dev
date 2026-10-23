import { describe, expect, it } from "vitest";
import { kanbanCardsPdfUrl, kanbanPrintIds, MAX_KANBAN_CARDS_PER_PDF } from "./kanban-print";

describe("kanbanCardsPdfUrl", () => {
  it("points at the server PDF (a plain link — no popup that can be blocked)", () => {
    expect(kanbanCardsPdfUrl("/planner", [12], "a5")).toBe("/planner/api/kanban-cards/pdf?ids=12&sheet=a5");
    expect(kanbanCardsPdfUrl("", [12, 40], "a4")).toBe("/api/kanban-cards/pdf?ids=12,40&sheet=a4");
  });

  it("is synchronous — a string, never a promise (the old await before window.open lost the click)", () => {
    const url = kanbanCardsPdfUrl("", [1], "a5");
    expect(typeof url).toBe("string");
  });

  it("returns null when there is nothing to print", () => {
    expect(kanbanCardsPdfUrl("", [], "a5")).toBeNull();
    expect(kanbanCardsPdfUrl("", [0, -3, 1.5], "a5")).toBeNull();
  });

  it("keeps order, drops duplicates and caps at the server limit", () => {
    expect(kanbanPrintIds([5, 3, 5, 9, 3])).toEqual([5, 3, 9]);
    const many = Array.from({ length: MAX_KANBAN_CARDS_PER_PDF + 25 }, (_, i) => i + 1);
    expect(kanbanPrintIds(many)).toHaveLength(MAX_KANBAN_CARDS_PER_PDF);
  });
});
