/**
 * Which face the Prep tab shows on a given plan.
 *
 * Prep lives on the PREP DAY's plan, not the run's (Graeme, 2026-09-04):
 * whoever preps on Sunday shouldn't have to know to open Monday. The same
 * shape as the dough stations, which read the next day's plan. So:
 *
 *   prep-day  — this plan's date IS the next run's prep date: show the sheet.
 *   run-day   — this plan IS the run: no sheet here, link back to the prep
 *               day instead.
 *   ahead     — a run exists but its prep day is later: say when, link to
 *               the prep day's plan if there is one.
 *   none      — no upcoming run at all.
 *
 * Pure, so the mapping is testable without a router or a network.
 */
import type { NextRun } from "./api";

export type PrepDayView =
  | { kind: "none" }
  | { kind: "prep-day"; runPlanId: number; runDate: string; packs: number }
  | { kind: "run-day"; prepDate: string; prepPlanId: number | null }
  | { kind: "ahead"; runDate: string; prepDate: string; prepPlanId: number | null; packs: number };

export function prepDayView(
  currentPlanId: number,
  currentPlanDate: string,
  run: NextRun | undefined,
): PrepDayView {
  if (!run || !run.found) return { kind: "none" };
  if (run.planId === currentPlanId) {
    return { kind: "run-day", prepDate: run.prepDate, prepPlanId: run.prepPlanId };
  }
  if (run.prepDate === currentPlanDate) {
    return { kind: "prep-day", runPlanId: run.planId, runDate: run.planDate, packs: run.packs };
  }
  return {
    kind: "ahead",
    runDate: run.planDate,
    prepDate: run.prepDate,
    prepPlanId: run.prepPlanId,
    packs: run.packs,
  };
}
