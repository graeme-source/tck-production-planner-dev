/**
 * Changing an idea into an improvement by hand, and sorting its photos into
 * before and after (Graeme, 27 Oct 2026; Objective E): "someone has uploaded
 * an idea, but really it's an improvement. They've put two before photos
 * when really it should be before and after."
 *
 * Pure rules only — the route (api-server routes/improvement-reclassify.ts)
 * loads the photos, applies the plan and records who did it.
 *
 * What an idea and an improvement ARE is unchanged: an idea is stage 'todo'
 * (nobody has done it yet); an improvement is anything past that. So
 * "change it to an improvement" means "it's done" — exactly what the after
 * photo upload or "I've done this" would have done — and the route sends it
 * through the same submitForApproval as those two, so credit, approval and
 * the celebration behave as if it had been logged right first time.
 *
 * Only the improvement's own evidence is sorted: photos posted in its
 * comments (comment_id set) and the generated before/after clip ('stitched')
 * are never offered and never accepted.
 */
import { stageOf } from "./improvement-stage";

export type PhotoRole = "before" | "after";
export type ReclassifyKind = "idea" | "improvement";

/** One of the improvement's own photos/videos, as stored. */
export interface EvidencePhoto {
  id: number;
  /** 'before' | 'after' | null (logged before the split, migration 0060). */
  phase: string | null;
}

export interface ReclassifyInput {
  kind: ReclassifyKind;
  currentStatus: string;
  /** The improvement's own evidence — no comment photos, no stitched clip. */
  evidence: EvidencePhoto[];
  /** What the manager chose. A photo left out keeps its current side. */
  assignments?: Array<{ id: number; role: PhotoRole }>;
}

export type StatusChange = "to_improvement" | "to_idea" | "none";

export type ReclassifyPlan =
  | {
      ok: true;
      /** Every evidence photo's side after the change, in id order. */
      phases: Array<{ id: number; phase: PhotoRole }>;
      /** Only the photos whose stored phase actually changes. */
      changed: Array<{ id: number; phase: PhotoRole }>;
      beforeCount: number;
      afterCount: number;
      statusChange: StatusChange;
      /** Turning an APPROVED improvement back into an idea takes its credit
       *  away — the screen warns, and the route says so in the timeline. */
      removesCredit: boolean;
    }
  | { ok: false; error: string };

/** Where a stored photo sits today. No phase reads as "before" — the same
 *  place the improvement page already shows it. */
export function currentRole(phase: string | null): PhotoRole {
  return phase === "after" ? "after" : "before";
}

export function planReclassify(input: ReclassifyInput): ReclassifyPlan {
  const { kind, currentStatus, evidence } = input;
  const assignments = input.assignments ?? [];
  const known = new Map(evidence.map(p => [p.id, p]));

  const seen = new Set<number>();
  for (const a of assignments) {
    if (seen.has(a.id)) return { ok: false, error: "The same photo was given twice — try again." };
    seen.add(a.id);
    if (!known.has(a.id)) {
      return { ok: false, error: "One of those photos isn't on this improvement any more — close this and open it again." };
    }
  }
  const chosen = new Map(assignments.map(a => [a.id, a.role]));

  if (kind === "idea" && assignments.some(a => a.role === "after")) {
    return { ok: false, error: "An idea can't have an after photo — it hasn't been done yet. Set them all to Before." };
  }

  const phases = [...evidence]
    .sort((a, b) => a.id - b.id)
    .map(p => ({
      id: p.id,
      // An idea is all "before": nothing is fixed yet.
      phase: kind === "idea" ? ("before" as const) : (chosen.get(p.id) ?? currentRole(p.phase)),
    }));
  const changed = phases.filter(p => known.get(p.id)!.phase !== p.phase);
  const beforeCount = phases.filter(p => p.phase === "before").length;
  const afterCount = phases.filter(p => p.phase === "after").length;

  if (kind === "improvement") {
    if (evidence.length === 0) {
      return { ok: false, error: "There are no photos on this yet — an improvement needs an after photo to count." };
    }
    if (afterCount === 0) {
      return { ok: false, error: "Set at least one photo to After — the after photo is what shows it's been done." };
    }
  }

  const stage = stageOf(currentStatus);
  const statusChange: StatusChange =
    kind === "improvement" && stage === "todo" ? "to_improvement"
    : kind === "idea" && stage !== "todo" ? "to_idea"
    : "none";

  return {
    ok: true,
    phases,
    changed,
    beforeCount,
    afterCount,
    statusChange,
    removesCredit: statusChange === "to_idea" && stage === "approved",
  };
}

const photos = (n: number, side: PhotoRole) => `${n} ${side} photo${n === 1 ? "" : "s"}`;

/**
 * The line left in the improvement's Comments & photos timeline, under the
 * manager's name, so anyone can see who changed it and when.
 */
export function reclassifyTimelineNote(plan: Extract<ReclassifyPlan, { ok: true }>): string {
  const split = plan.afterCount > 0
    ? `${photos(plan.beforeCount, "before")} and ${photos(plan.afterCount, "after")}`
    : photos(plan.beforeCount, "before");
  switch (plan.statusChange) {
    case "to_improvement":
      return `Changed this from an idea to an improvement — ${split}.`;
    case "to_idea":
      return plan.removesCredit
        ? `Changed this back to an idea — it no longer counts as a finished improvement. ${split[0]!.toUpperCase()}${split.slice(1)}.`
        : `Changed this back to an idea. ${split[0]!.toUpperCase()}${split.slice(1)}.`;
    default:
      return `Sorted the photos into before and after — ${split}.`;
  }
}
