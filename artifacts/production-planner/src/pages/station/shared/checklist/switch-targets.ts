import { STATIONS } from "../constants";
import { planTargetForStation, pinsPlan, type PlanTarget } from "../../../../lib/station-plan-target";

export interface ChecklistSwitchTarget {
  key: string;
  label: string;
  /** In-app path that opens that station's checklist on that station's own
   *  plan, or null when it has no plan right now (or it's still loading). */
  href: string | null;
}

/** The plan each kind of station is working right now — the same three the
 *  dashboard resolves (lib/station-plan-target.ts). */
export interface StationPlanIds {
  today: number | null;
  nextPrep: number | null;
  nextDough: number | null;
}

function planFor(target: PlanTarget, plans: StationPlanIds): number | null {
  return target === "today" ? plans.today : target === "next-prep" ? plans.nextPrep : plans.nextDough;
}

/**
 * The other stations a person can hop to from a station's checklist screen
 * (issue #399, Kerri-Leigh, 13 Nov 2026: closing down packing AND wrapping
 * meant going out to the main page between the two). Built from the shared
 * STATIONS list, so a new station appears here without touching this file.
 * `?view=checklist` makes the station page open on its checklist rather than
 * the time-of-day default.
 *
 * Each station opens on ITS OWN day (Graeme, 20 Nov 2026, Fix queue #406).
 * Prep and dough prep work a day ahead of everyone else, so carrying the
 * same plan across opened yesterday's finished prep list from mixing ("completed
 * before I've even looked") and put Kerri-Leigh's building ticks on tomorrow's
 * list from prep. A station working the same day as this one keeps this
 * plan (so looking back at an old day stays on that day); any other goes to
 * the plan the dashboard would open for it.
 */
export function checklistSwitchTargets(
  planId: number,
  currentStation: string,
  plans: StationPlanIds | null,
): ChecklistSwitchTarget[] {
  const here = planTargetForStation(currentStation);
  return STATIONS
    .filter(s => s.key !== currentStation)
    .map(s => {
      const there = planTargetForStation(s.key);
      const id = there === here ? planId : plans ? planFor(there, plans) : null;
      return {
        key: s.key,
        label: s.label,
        href: id == null ? null : `/plans/${id}/station/${s.key}?${pinsPlan(s.key) ? "direct=1&" : ""}view=checklist`,
      };
    });
}

