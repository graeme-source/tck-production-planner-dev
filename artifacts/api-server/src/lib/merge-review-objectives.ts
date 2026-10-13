/**
 * Turning a review's split-up "objectives" back into ONE "What was agreed"
 * list — the pure half of scripts/merge-review-objectives-into-agreement.ts
 * (Graeme, 2026-10-13: "It's created lots of objectives where it's
 * basically just a list of things we agreed… they're not to-dos").
 *
 * Which notes: the ones named (--notes), else every live objective on the
 * entry that the AI save wrote — it inserts the write-up and the pasted
 * source in one transaction, so they share the source's created_at exactly.
 *
 * What it makes: one agreement (kind "agreement", 0186) with a bullet per
 * objective, "Title — body". Same author, the earliest created_at, the same
 * private/shared state (and the earliest shared_at). If that author already
 * has a list on the review in the same state, the bullets join it instead —
 * one list per review. The objectives are soft-deleted, never removed.
 * Re-running finds nothing left to merge.
 */
import { agreementBody, appendAgreementBullets, AGREEMENT_TITLE } from "@workspace/people-reviews";

export interface MergeNote {
  id: number;
  entryId: number | null;
  userId: number;
  kind: string;
  title: string | null;
  body: string;
  visibility: string;
  sharedAt: Date | null;
  authorId: number | null;
  authorName: string | null;
  createdAt: Date;
  doneAt: Date | null;
  deletedAt: Date | null;
}

export type MergePlan =
  | { ok: true; nothing: true; message: string }
  | {
    ok: true;
    nothing: false;
    mergeIds: number[];
    bullets: string[];
    /** Add to this existing list… */
    appendTo: { id: number; body: string } | null;
    /** …or insert this one. */
    insert: {
      entryId: number; userId: number; kind: "agreement"; title: string; body: string;
      visibility: string; sharedAt: Date | null; authorId: number | null; authorName: string | null; createdAt: Date;
    } | null;
    auditDetail: string;
    warnings: string[];
  }
  | { ok: false; error: string };

/** One objective as a bullet: "Title — body", or whichever there is. */
export function objectiveBullet(n: Pick<MergeNote, "title" | "body">): string {
  const title = (n.title ?? "").replace(/\s+/g, " ").trim();
  const body = n.body.replace(/\s+/g, " ").trim();
  if (title && body && title.toLowerCase() !== body.toLowerCase()) return `${title} — ${body}`;
  return title || body;
}

export function planMergeIntoAgreement(input: {
  entryId: number;
  notes: readonly MergeNote[];
  /** created_at of the entry's AI sources (people_record_entry_sources). */
  sourceTimes: readonly Date[];
  /** Named notes; otherwise the AI save's objectives are found by time. */
  noteIds?: readonly number[] | null;
}): MergePlan {
  const { entryId, notes } = input;
  const onEntry = notes.filter(n => n.entryId === entryId);
  let chosen: MergeNote[];
  if (input.noteIds && input.noteIds.length > 0) {
    const ids = new Set(input.noteIds);
    const found = onEntry.filter(n => ids.has(n.id));
    const missing = [...ids].filter(id => !found.some(n => n.id === id));
    if (missing.length) return { ok: false, error: `Note${missing.length === 1 ? "" : "s"} ${missing.join(", ")} ${missing.length === 1 ? "isn't" : "aren't"} on entry ${entryId}.` };
    const wrong = found.filter(n => n.kind !== "objective");
    if (wrong.length) return { ok: false, error: `Only objectives can be merged — ${wrong.map(n => `#${n.id} is "${n.kind}"`).join(", ")}.` };
    chosen = found.filter(n => n.deletedAt == null);
    if (chosen.length === 0) return { ok: true, nothing: true, message: "Those notes are already merged (soft-deleted) — nothing to do." };
  } else {
    const times = new Set(input.sourceTimes.map(t => t.getTime()));
    if (times.size === 0) return { ok: false, error: `Entry ${entryId} has no AI source to match — pass --notes id,id,… to choose them.` };
    chosen = onEntry.filter(n => n.kind === "objective" && n.deletedAt == null && times.has(n.createdAt.getTime()));
    if (chosen.length === 0) return { ok: true, nothing: true, message: `No objectives from an AI save left on entry ${entryId} — nothing to do.` };
  }
  chosen = [...chosen].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);

  const authors = new Set(chosen.map(n => n.authorId ?? -1));
  if (authors.size > 1) return { ok: false, error: "Those objectives have different authors — merge each author's separately with --notes." };
  const states = new Set(chosen.map(n => n.visibility));
  if (states.size > 1) return { ok: false, error: "Some are shared and some private — merge each group separately with --notes." };

  const first = chosen[0]!;
  const bullets = chosen.map(objectiveBullet).filter(Boolean);
  const visibility = first.visibility;
  const sharedTimes = chosen.map(n => n.sharedAt).filter((d): d is Date => d != null).sort((a, b) => a.getTime() - b.getTime());
  const warnings: string[] = [];
  const done = chosen.filter(n => n.doneAt != null);
  if (done.length) warnings.push(`${done.length} of them ${done.length === 1 ? "was" : "were"} marked done — an agreed list has no "done"; that tick goes with the soft-deleted objective.`);

  const existing = onEntry.find(n => n.kind === "agreement" && n.deletedAt == null
    && (n.authorId ?? -1) === (first.authorId ?? -1) && n.visibility === visibility);

  const ids = chosen.map(n => `#${n.id}`).join(", ");
  const auditDetail = `${chosen.length} objective${chosen.length === 1 ? "" : "s"} (${ids}) merged into one "What was agreed" list`
    + `${existing ? ` (#${existing.id})` : ""}, ${visibility} as before; the objectives are kept, soft-deleted`;

  return {
    ok: true,
    nothing: false,
    mergeIds: chosen.map(n => n.id),
    bullets,
    appendTo: existing ? { id: existing.id, body: appendAgreementBullets(existing.body, bullets) } : null,
    insert: existing ? null : {
      entryId, userId: first.userId, kind: "agreement", title: AGREEMENT_TITLE, body: agreementBody(bullets),
      visibility, sharedAt: visibility === "shared" ? (sharedTimes[0] ?? null) : null,
      authorId: first.authorId, authorName: first.authorName, createdAt: first.createdAt,
    },
    auditDetail: auditDetail.slice(0, 500),
    warnings,
  };
}
