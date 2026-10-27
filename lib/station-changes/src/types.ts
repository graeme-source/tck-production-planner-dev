/**
 * Station changes — "what's changed in this station?" (Graeme, 27 Oct 2026;
 * objectives E, F and H). Every System Update entry is tagged with the
 * area(s) of the factory it affects, so the morning meeting can show station
 * work only, grouped by station, and each station can show its own recent
 * changes with a walkthrough attached.
 *
 * The areas themselves are DATA (table change_areas, migration 0300), never
 * a hard-coded list in logic: everything here takes them as an argument.
 */

/** station = a place on the factory floor; planning = the people who plan
 *  production (plans, orders, stock control, recipes); office = sales,
 *  marketing, finance, people and behind-the-scenes work — never shown to
 *  the team in the morning meeting. */
export type ChangeAreaKind = "station" | "planning" | "office";

export interface ChangeArea {
  key: string;
  label: string;
  kind: ChangeAreaKind;
  sortOrder: number;
  /** The station screens (route keys, e.g. "building_1") this area's changes
   *  show on. Empty for areas with no station screen of their own. */
  stationTypes: string[];
  /** True for "Every station" — its changes show on every station screen. */
  appliesToAllStations: boolean;
  /** Lower-case substrings of file paths that point at this area. */
  pathHints: string[];
  /** Lower-case words or phrases in a title/body that point at this area. */
  wordHints: string[];
}

/** One walkthrough step. `target` is the value of a `data-tour="…"`
 *  attribute on the station screen; null shows the step centred (an intro
 *  or a summary). `hiddenNote` is what to say when the target isn't on the
 *  screen right now (e.g. "It appears once a batch is made."). */
export interface TutorialStep {
  target: string | null;
  title: string;
  body: string;
  hiddenNote?: string | null;
}

export interface Tutorial {
  steps: TutorialStep[];
}

/** A change entry as the station screens and the meeting slide see it. */
export interface StationChange {
  id: number;
  title: string;
  bullets: string[];
  areas: string[];
  createdAt: string; // ISO 8601
  hasImage: boolean;
  tutorial: Tutorial | null;
}
