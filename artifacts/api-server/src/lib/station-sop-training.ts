/**
 * Station SOP training — the rules, with no database in sight (Graeme,
 * 2026-09-24). routes/station-training.ts gathers the facts and asks these
 * functions what they mean; station-sop-training.test.ts pins every rule.
 *
 * The SOPs on the front of a station are that station's training. Anyone
 * working the station must have reviewed each one AS IT STANDS: a change to
 * an SOP's steps bumps its content_version, and everyone whose last review
 * is older drops to "needs refresher" until they review it again.
 */

export type ReviewStatus = "trained" | "refresher" | "untrained";

/** Where someone stands on one SOP: never reviewed, reviewed an older
 *  version, or reviewed the current one. */
export function reviewStatus(reviewedVersion: number | null | undefined, currentVersion: number): ReviewStatus {
  if (reviewedVersion == null) return "untrained";
  return reviewedVersion >= currentVersion ? "trained" : "refresher";
}

/** How long someone may put off an SOP review, counted from the FIRST time
 *  the gate asked them. After that it's review it or leave the station. */
export const SKIP_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface OutstandingSop {
  sopId: number;
  /** When they were first asked to review it (start of their window). */
  firstPromptedAt: Date;
}

export interface GatePass {
  kind: "skipped" | "just_looking";
  validUntil: Date;
  /** The SOPs outstanding when the pass was granted. */
  sopIds: number[];
}

export interface GateInput {
  outstanding: OutstandingSop[];
  now: Date;
  /** Kill switch — off means nobody is blocked; outstanding reviews still show. */
  enforce: boolean;
  /** Planday rota puts them on this station today — they're working it. */
  rostered: boolean;
  /** Their newest unexpired skip / just-checking pass for this station. */
  pass: GatePass | null;
}

export interface GateDecision {
  /** Block the station behind the review screen. */
  show: boolean;
  /** Window closed — these must be reviewed before the station opens. */
  required: number[];
  /** Still inside their 24 hours — can be put off with "Skip for now". */
  deferrable: number[];
  canSkip: boolean;
  /** When a skip taken now runs out (the earliest deferrable deadline). */
  skipUntil: Date | null;
  /** "Just checking — I'm not working here": only for people the rota
   *  doesn't put on this station today. */
  canJustLook: boolean;
}

export function deadlineFor(firstPromptedAt: Date): Date {
  return new Date(firstPromptedAt.getTime() + SKIP_WINDOW_MS);
}

export function gateDecision(input: GateInput): GateDecision {
  const { outstanding, now, enforce, rostered, pass } = input;
  const required: number[] = [];
  const deferrable: number[] = [];
  let skipUntil: Date | null = null;
  for (const o of outstanding) {
    const deadline = deadlineFor(o.firstPromptedAt);
    if (now.getTime() >= deadline.getTime()) {
      required.push(o.sopId);
    } else {
      deferrable.push(o.sopId);
      if (!skipUntil || deadline < skipUntil) skipUntil = deadline;
    }
  }
  const canSkip = outstanding.length > 0 && required.length === 0;
  const canJustLook = !rostered;

  let covered = false;
  if (pass && pass.validUntil.getTime() > now.getTime()) {
    if (pass.kind === "just_looking") {
      // Honoured only while they're still not on the rota here — being
      // rostered onto the station mid-day ends the "just checking".
      covered = canJustLook;
    } else {
      // A skip covers exactly what was outstanding when it was taken. A
      // newly attached or newly changed SOP brings the gate back, and a
      // skip can never outlive a deadline (it expires at the earliest one).
      const skipped = new Set(pass.sopIds);
      covered = required.length === 0 && outstanding.every(o => skipped.has(o.sopId));
    }
  }

  return {
    show: enforce && outstanding.length > 0 && !covered,
    required,
    deferrable,
    canSkip,
    skipUntil,
    canJustLook,
  };
}

/** End of the London calendar day containing `now` — when a "just
 *  checking" pass runs out. */
export function endOfLondonDay(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
  const secondsIntoDay = get("hour") * 3600 + get("minute") * 60 + get("second");
  const msLeft = (24 * 3600 - secondsIntoDay) * 1000 - now.getMilliseconds();
  return new Date(now.getTime() + msLeft);
}

// ── Rota → stations ────────────────────────────────────────────────────────
//
// The morning meeting's rota slide already maps Planday positions onto
// station TITLES (app setting station_assignments_mapping, editable). These
// are the planner station keys each of those titles means. An entry in the
// setting may also carry an explicit `stationKeys` list, which wins.

const ROTA_TITLE_STATIONS: Record<string, string[]> = {
  "dough prep": ["dough_prep"],
  "dough sheeting": ["dough_sheeting"],
  "sheeting": ["dough_sheeting"],
  "prep": ["prep", "main_prep", "prep_bases", "prep_meat"],
  "main prep": ["main_prep"],
  "mixing": ["mixing"],
  "mixing & cooking": ["mixing"],
  "building table 1": ["building_1"],
  "building table 2": ["building_2"],
  "ovens": ["ovens"],
  "fried chicken": ["fried_chicken"],
  "wrapping": ["wrapping"],
  "packing": ["packing"],
  "macaroni cheese": ["macaroni_cheese"],
  "mac cheese": ["macaroni_cheese"],
};

export interface RotaMapping {
  stations: Array<{ title: string; positions: string[]; stationKeys?: string[] }>;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** The station keys a person's rostered Planday positions put them on. */
export function rosteredStations(positionNames: string[], mapping: RotaMapping): Set<string> {
  const out = new Set<string>();
  const wanted = new Set(positionNames.map(norm));
  for (const entry of mapping.stations ?? []) {
    if (!(entry.positions ?? []).some(p => wanted.has(norm(p)))) continue;
    const keys = entry.stationKeys?.length ? entry.stationKeys : ROTA_TITLE_STATIONS[norm(entry.title)] ?? [];
    for (const k of keys) out.add(k);
  }
  return out;
}
