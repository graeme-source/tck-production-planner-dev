import { describe, it, expect } from "vitest";
import { prepDayView } from "./prep-day";
import type { NextRun } from "./api";

const run: NextRun = {
  found: true,
  planId: 160,
  planName: "Monday",
  planDate: "2026-09-07",
  prepDate: "2026-09-06",
  prepPlanId: 155,
  packs: 204,
  isPrepDay: false,
  isRunDay: false,
};

describe("prepDayView", () => {
  it("shows the sheet on the prep day, driven by the RUN's plan", () => {
    // Sunday's plan carries Monday's pull list — whoever preps on Sunday
    // shouldn't have to know to open Monday.
    expect(prepDayView(155, "2026-09-06", run)).toEqual({
      kind: "prep-day", runPlanId: 160, runDate: "2026-09-07", packs: 204,
    });
  });

  it("on the run day, points back at the prep day instead of repeating the sheet", () => {
    expect(prepDayView(160, "2026-09-07", run)).toEqual({
      kind: "run-day", prepDate: "2026-09-06", prepPlanId: 155,
    });
  });

  it("ahead of the prep day, says when prep happens", () => {
    expect(prepDayView(150, "2026-09-04", run)).toEqual({
      kind: "ahead", runDate: "2026-09-07", prepDate: "2026-09-06", prepPlanId: 155, packs: 204,
    });
  });

  it("survives a prep day with no plan on it", () => {
    const orphan = { ...run, prepPlanId: null };
    expect(prepDayView(160, "2026-09-07", orphan)).toEqual({
      kind: "run-day", prepDate: "2026-09-06", prepPlanId: null,
    });
  });

  it("says so when no run is coming", () => {
    expect(prepDayView(1, "2026-09-06", { found: false })).toEqual({ kind: "none" });
    expect(prepDayView(1, "2026-09-06", undefined)).toEqual({ kind: "none" });
  });
});
