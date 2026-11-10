import { describe, it, expect } from "vitest";
import { canSnoozeKanban, kanbanSnoozeTarget, kanbanWaitingUntil } from "./kanban-snooze";

describe("kanban Not today", () => {
  it("comes back tomorrow, across a month end", () => {
    expect(kanbanSnoozeTarget("2026-11-10")).toBe("2026-11-11");
    expect(kanbanSnoozeTarget("2026-11-30")).toBe("2026-12-01");
  });

  it("only puts off a pulled kanban that's on today's orders", () => {
    expect(canSnoozeKanban({ status: "pulled", orderDayTarget: "2026-11-10" }, "2026-11-10")).toBe(true);
    expect(canSnoozeKanban({ status: "pulled", orderDayTarget: "2026-11-07" }, "2026-11-10")).toBe(true);
    expect(canSnoozeKanban({ status: "pulled", orderDayTarget: "2026-11-11" }, "2026-11-10")).toBe(false);
    expect(canSnoozeKanban({ status: "active", orderDayTarget: null }, "2026-11-10")).toBe(false);
    expect(canSnoozeKanban({ status: "ordered", orderDayTarget: "2026-11-10" }, "2026-11-10")).toBe(false);
  });

  it("stays pulled: put off today, it's waiting until tomorrow", () => {
    const today = "2026-11-10";
    const row = { status: "pulled", orderDayTarget: kanbanSnoozeTarget(today) };
    expect(kanbanWaitingUntil(row, today)).toBe("2026-11-11");
    // Next day it's back on the orders, not waiting.
    expect(kanbanWaitingUntil(row, "2026-11-11")).toBeNull();
    expect(kanbanWaitingUntil({ status: "active", orderDayTarget: null }, today)).toBeNull();
    expect(kanbanWaitingUntil(undefined, today)).toBeNull();
  });
});
