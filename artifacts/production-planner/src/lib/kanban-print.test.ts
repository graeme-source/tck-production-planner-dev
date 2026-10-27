import { describe, expect, it } from "vitest";
import { kanbanCardsPdfUrl, kanbanPdfFileName, kanbanPrintIds, kanbanPrintMethod, looksLikeIpad, MAX_KANBAN_CARDS_PER_PDF } from "./kanban-print";

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

describe("kanbanPrintMethod (#365: no print button from the home-screen app)", () => {
  const base = { standalone: false, ipad: false, canShareFiles: true };

  it("uses the share sheet when the app runs from its home-screen icon", () => {
    expect(kanbanPrintMethod({ ...base, standalone: true })).toBe("share");
  });

  it("uses the share sheet on an iPad in Safari too", () => {
    expect(kanbanPrintMethod({ ...base, ipad: true })).toBe("share");
  });

  it("keeps the plain new-tab link on a desktop", () => {
    expect(kanbanPrintMethod(base)).toBe("link");
  });

  it("falls back to the link when the browser can't share files", () => {
    expect(kanbanPrintMethod({ standalone: true, ipad: true, canShareFiles: false })).toBe("link");
  });

  it("spots an iPad that reports itself as a Mac", () => {
    expect(looksLikeIpad("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true);
    expect(looksLikeIpad("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", 5)).toBe(true);
    expect(looksLikeIpad("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(false);
    expect(looksLikeIpad("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 0)).toBe(false);
  });

  it("names the shared file by card count and paper", () => {
    expect(kanbanPdfFileName(1, "a5")).toBe("kanban-card-a5.pdf");
    expect(kanbanPdfFileName(3, "a4")).toBe("kanban-cards-a4.pdf");
  });
});
