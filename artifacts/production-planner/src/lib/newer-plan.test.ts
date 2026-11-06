import { describe, it, expect } from "vitest";
import { newerPlanThan } from "./newer-plan";

const plan = (id: number, planDate: string, status = "active") => ({ id, planDate, status });

describe("newerPlanThan", () => {
  it("finds Tuesday's plan while Orders is still on Monday's (order 769, 6 Nov)", () => {
    const plans = [plan(217, "2026-11-09"), plan(220, "2026-11-10")];
    expect(newerPlanThan(plans, 217)?.id).toBe(220);
  });

  it("says nothing when the selected plan is the latest", () => {
    expect(newerPlanThan([plan(217, "2026-11-09"), plan(220, "2026-11-10")], 220)).toBeNull();
  });

  it("goes by the production date, not the order the plan was made in", () => {
    expect(newerPlanThan([plan(220, "2026-11-10"), plan(221, "2026-11-09")], 220)).toBeNull();
  });

  it("names the latest when several are newer", () => {
    const plans = [plan(1, "2026-11-09"), plan(3, "2026-11-11"), plan(2, "2026-11-10")];
    expect(newerPlanThan(plans, 1)?.id).toBe(3);
  });

  it("ignores plans that aren't active", () => {
    expect(newerPlanThan([plan(1, "2026-11-09"), plan(2, "2026-11-10", "draft")], 1)).toBeNull();
  });

  it("ignores another plan on the same day", () => {
    expect(newerPlanThan([plan(1, "2026-11-09"), plan(2, "2026-11-09")], 1)).toBeNull();
  });

  it("says nothing with no plan selected", () => {
    expect(newerPlanThan([plan(1, "2026-11-09")], null)).toBeNull();
  });
});
