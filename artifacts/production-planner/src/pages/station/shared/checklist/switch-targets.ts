import { STATIONS } from "../constants";

export interface ChecklistSwitchTarget {
  key: string;
  label: string;
  /** In-app path that opens that station's checklist for the same plan. */
  href: string;
}

/**
 * The other stations a person can hop to from a station's checklist screen
 * (issue #399, Kerri-Leigh, 13 Nov 2026: closing down packing AND wrapping
 * meant going out to the main page between the two). Built from the shared
 * STATIONS list, so a new station appears here without touching this file.
 * `?view=checklist` makes the station page open on its checklist rather than
 * the time-of-day default.
 */
export function checklistSwitchTargets(planId: number, currentStation: string): ChecklistSwitchTarget[] {
  return STATIONS
    .filter(s => s.key !== currentStation)
    .map(s => ({
      key: s.key,
      label: s.label,
      href: `/plans/${planId}/station/${s.key}?view=checklist`,
    }));
}
