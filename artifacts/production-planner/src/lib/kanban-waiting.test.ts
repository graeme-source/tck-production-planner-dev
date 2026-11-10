import { describe, it, expect } from "vitest";
import { kanbanWaitingLabel } from "./kanban-waiting";

describe("kanbanWaitingLabel", () => {
  it("says tomorrow for the next day, the weekday further out", () => {
    expect(kanbanWaitingLabel("2026-11-11", "2026-11-10")).toBe("back tomorrow");
    expect(kanbanWaitingLabel("2026-11-12", "2026-11-10")).toBe("back Thu");
  });
  it("is nothing once the day has come, or when not waiting", () => {
    expect(kanbanWaitingLabel("2026-11-10", "2026-11-10")).toBeNull();
    expect(kanbanWaitingLabel(null, "2026-11-10")).toBeNull();
  });
});
