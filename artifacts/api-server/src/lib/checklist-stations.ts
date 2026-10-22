/**
 * Shared checklists: stations on the left share a single checklist stored
 * under the canonical station on the right. Editing or viewing the alias
 * transparently routes to the canonical record so a "weekly Monday" item
 * added to either station shows up on both for every user.
 *
 * Pure (no DB) so the aliasing rule is unit-tested.
 */
export const SHARED_CHECKLIST_STATIONS: Readonly<Record<string, string>> = {
  building_2: "building_1",
  // Dough Prep and Dough Sheeting used to share Dough Sheeting's checklist;
  // they are separate jobs and now have separate checklists (Fix queue #171,
  // data split by migration 0220_dough_prep_own_checklist.sql).
  //
  // The prep area is ONE physical station with one checklist, whichever
  // section (hub, main, bases, raw meat) it's opened from. Before 2026-07-30
  // each section had its own cloned copy, so a tick in one section didn't
  // show in the others and the team thought the checklist was undoing
  // itself. Existing templates/history were merged into 'prep' by the
  // prep_checklist_merge_v1 startup migration.
  main_prep: "prep",
  prep_bases: "prep",
  prep_meat: "prep",
};

/** Resolve to the canonical station type for checklist storage.
 *  Routes that store per-station-per-plan records alongside the checklist
 *  (curiosity walks) must share this aliasing or building_2 and the prep
 *  sections would each get their own copy. */
export function resolveChecklistStation(stationType: string): string {
  return SHARED_CHECKLIST_STATIONS[stationType] ?? stationType;
}
