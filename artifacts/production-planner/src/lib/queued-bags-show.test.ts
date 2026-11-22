import { describe, expect, it } from "vitest";
import { planningDayFor, showQueuedOrder } from "./queued-bags-show";

describe("planningDayFor", () => {
  it("is two working days before the make-day", () => {
    expect(planningDayFor("2026-12-01")).toBe("2026-11-27"); // Tue → Fri
    expect(planningDayFor("2026-12-02")).toBe("2026-11-30"); // Wed → Mon
    expect(planningDayFor("2026-12-03")).toBe("2026-12-01"); // Thu → Tue
    expect(planningDayFor("2026-11-30")).toBe("2026-11-26"); // Mon → Thu
  });
});

describe("showQueuedOrder", () => {
  const tue = { productionDate: "2026-12-01", overdue: false };
  it("stays hidden in the days before the plan is normally made", () => {
    expect(showQueuedOrder(tue, "2026-11-22")).toBe(false);
    expect(showQueuedOrder(tue, "2026-11-26")).toBe(false);
  });
  it("shows from the morning the plan is normally made", () => {
    expect(showQueuedOrder(tue, "2026-11-27")).toBe(true);
    expect(showQueuedOrder(tue, "2026-11-30")).toBe(true);
  });
  it("always shows an overdue order", () => {
    expect(showQueuedOrder({ productionDate: "2026-12-01", overdue: true }, "2026-11-22")).toBe(true);
  });
});
