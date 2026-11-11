import { describe, it, expect } from "vitest";
import { newerPlanThan, orderingPlan, rememberedPlanId, staleOrderingPlan } from "./newer-plan";

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

describe("the plan today's orders are for (11 Nov 2026)", () => {
  // Wed 11 Nov: Thursday's plan preps today, Friday's tomorrow, Monday's later.
  const p = (id: number, planDate: string, prepDate: string, status = "active") => ({ id, planDate, prepDate, status });
  const plans = [p(221, "2026-11-11", "2026-11-10"), p(223, "2026-11-12", "2026-11-11"), p(224, "2026-11-13", "2026-11-12"), p(222, "2026-11-16", "2026-11-13")];
  const today = "2026-11-11";

  it("is Friday's plan — the next one whose prep hasn't started", () => {
    expect(orderingPlan(plans, today)?.id).toBe(224);
  });

  it("left on Thursday's plan, the page is pointed at Friday's — not Monday's", () => {
    expect(staleOrderingPlan(plans, 223, today)?.id).toBe(224);
    expect(newerPlanThan(plans, 223)?.id).toBe(222); // the old banner's answer
  });

  it("no switch when already on it, or looking ahead on purpose", () => {
    expect(staleOrderingPlan(plans, 224, today)).toBeNull();
    expect(staleOrderingPlan(plans, 222, today)).toBeNull();
  });

  it("with nothing still to prep, the latest plan", () => {
    expect(orderingPlan([p(1, "2026-11-10", "2026-11-09"), p(2, "2026-11-11", "2026-11-10")], today)?.id).toBe(2);
  });

  it("a plan with no prep date preps on its own day", () => {
    expect(orderingPlan([{ id: 5, planDate: "2026-11-12", status: "active" }, { id: 6, planDate: "2026-11-11", status: "active" }], today)?.id).toBe(5);
  });

  it("a remembered choice lasts the day it was made only", () => {
    expect(rememberedPlanId(JSON.stringify({ id: 223, on: today }), today)).toBe(223);
    expect(rememberedPlanId(JSON.stringify({ id: 223, on: "2026-11-10" }), today)).toBeNull();
    expect(rememberedPlanId("223", today)).toBeNull();
    expect(rememberedPlanId(null, today)).toBeNull();
  });
});

