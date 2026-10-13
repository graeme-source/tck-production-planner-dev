/**
 * Accident or incident? (Graeme, 2026-10-13: "The quick action button should
 * ask, 'Is it an incident or an accident?' and give a brief description of
 * what those things are. If someone doesn't know, it tells them how to
 * identify them, with maybe an example for each.") Objective B.
 *
 * Wording follows the HSE's plain-English definitions: an ACCIDENT is an
 * event that results in injury or ill health; an INCIDENT is a near miss
 * (no harm, but it could have) or something going wrong that harms no one
 * (food safety, quality, damage). The diary also keeps "near miss" as its
 * own type — a kind of incident — chosen inside the report's Type field.
 *
 * The diary's stored type values are 'accident' | 'incident' | 'near_miss'
 * (incident_reports.kind; the API's zod enum in routes/incidents.ts).
 */

export type IncidentKind = "accident" | "incident" | "near_miss";

export const INCIDENT_KINDS: readonly IncidentKind[] = ["accident", "incident", "near_miss"];

/** Labels for the report's Type field and the diary chips. */
export const INCIDENT_KIND_LABEL: Record<IncidentKind, string> = {
  accident: "Accident",
  incident: "Incident",
  near_miss: "Near miss",
};

/** The Type field's options, each with its plain-English meaning. */
export const INCIDENT_KIND_OPTIONS: Array<{ kind: IncidentKind; label: string }> = [
  { kind: "accident", label: "Accident — someone was hurt or made ill" },
  { kind: "incident", label: "Incident — something went wrong, nobody hurt" },
  { kind: "near_miss", label: "Near miss — nearly went wrong, nobody hurt" },
];

export type IncidentChoice = "accident" | "incident";

export interface IncidentChoiceCard {
  choice: IncidentChoice;
  /** The diary type a new report from this card starts as. */
  kind: IncidentKind;
  title: string;
  meaning: string;
  examples: string[];
}

export const INCIDENT_CHOOSER_QUESTION = "Is it an accident or an incident?";

export const INCIDENT_CHOICES: IncidentChoiceCard[] = [
  {
    choice: "accident",
    kind: "accident",
    title: "Accident",
    meaning: "Someone was hurt or made ill at work — any injury, however small.",
    examples: ["Cut a finger on a knife while prepping", "Burned a hand on an oven tray"],
  },
  {
    choice: "incident",
    kind: "incident",
    title: "Incident",
    meaning: "Something went wrong or nearly went wrong, but nobody was hurt: near misses, food safety or quality problems, damage.",
    examples: ["Found a piece of blue plastic in the dough (foreign object)", "Slipped on a wet floor but didn't fall"],
  },
];

export const INCIDENT_NOT_SURE_TITLE = "Not sure?";
export const INCIDENT_NOT_SURE_RULE = "Was anyone hurt or made ill? Yes → Accident. No → Incident.";
export const INCIDENT_NOT_SURE_NOTE = "A near miss counts as an incident — you can mark it as \"Near miss\" in the report's Type.";

/**
 * The diary's "New report" button (Graeme, 2026-10-13: it asks the same
 * question before starting a report). The button only ever opens the
 * chooser; a report is created when a card is picked, then opens inline.
 */
export type NewReportFlow =
  | { step: "idle" }
  | { step: "choosing" }
  | { step: "creating"; kind: IncidentKind };

export type NewReportEvent =
  | { type: "newReport" }
  | { type: "choose"; kind: IncidentKind }
  | { type: "created" }
  | { type: "failed" }
  | { type: "cancel" };

export const NEW_REPORT_IDLE: NewReportFlow = { step: "idle" };

export function newReportFlow(state: NewReportFlow, event: NewReportEvent): NewReportFlow {
  switch (event.type) {
    case "newReport":
      return state.step === "idle" ? { step: "choosing" } : state;
    case "choose":
      return state.step === "choosing" ? { step: "creating", kind: event.kind } : state;
    case "created":
      return NEW_REPORT_IDLE;
    case "failed":
      return state.step === "creating" ? { step: "choosing" } : state;
    case "cancel":
      // Can't back out mid-create — the report is already on its way.
      return state.step === "creating" ? state : NEW_REPORT_IDLE;
  }
}

/** The diary type a chooser card starts a new report as. */
export function kindForChoice(choice: IncidentChoice): IncidentKind {
  const card = INCIDENT_CHOICES.find(c => c.choice === choice);
  if (!card) throw new Error(`Unknown choice: ${choice}`);
  return card.kind;
}
