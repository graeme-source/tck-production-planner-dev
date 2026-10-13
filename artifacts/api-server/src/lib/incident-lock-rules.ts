/**
 * Lock rules for signed accident & incident reports (Graeme, 2026-10-13:
 * "we do want to lock signed incident reports, but we want to be able to
 * unlock them and update them or add stuff to them"). Objective B — the
 * diary is HACCP evidence.
 *
 *  - A report is LOCKED once signed: its wording and fields can't change
 *    (the API answers 409). Photos can still be added — they are marked
 *    "added after signing" and never touch the report row.
 *  - A manager/admin may UNLOCK a signed report with a short reason. The
 *    signed version is kept as a JSON snapshot in incident_report_history,
 *    so nothing that was signed is ever lost.
 *  - Signing again re-locks it as the next version (v2, v3…). The history
 *    shows each signed version, each unlock (who/when/why) and what changed
 *    between consecutive signed versions.
 *
 * Pure — no DB — so the rules are unit-tested (incident-lock-rules.test.ts).
 */

/** The report's content: what a signature stands behind. The snapshot and
 *  the diff cover exactly these, in this order. (Status open/closed, the
 *  signature itself and photos are lifecycle, not wording.) */
export const INCIDENT_CONTENT_FIELDS = [
  { key: "kind", label: "Type", type: "kind" },
  { key: "occurredAt", label: "When it happened", type: "datetime" },
  { key: "title", label: "What happened (one line)", type: "text" },
  { key: "location", label: "Where in the factory", type: "text" },
  { key: "description", label: "Full description", type: "text" },
  { key: "peopleInvolved", label: "People involved / witnesses", type: "text" },
  { key: "injuries", label: "Injuries & first aid", type: "text" },
  { key: "foodSafetyImpact", label: "Food safety impact", type: "text" },
  { key: "immediateActions", label: "Immediate actions taken", type: "text" },
  { key: "correctiveActions", label: "Corrective actions", type: "text" },
  { key: "productionStopped", label: "Production stopped in the area", type: "bool" },
  { key: "foodDiscarded", label: "At-risk food thrown away", type: "bool" },
  { key: "riskAssessmentDone", label: "Risk assessment carried out", type: "bool" },
  { key: "areaCleaned", label: "Area cleaned & sanitised", type: "bool" },
] as const;

export type IncidentContentKey = (typeof INCIDENT_CONTENT_FIELDS)[number]["key"];
export type IncidentFieldType = (typeof INCIDENT_CONTENT_FIELDS)[number]["type"];
export type IncidentSnapshot = Record<IncidentContentKey, string | boolean | null>;

export interface IncidentLockState {
  signedAt: Date | string | null;
  unlockedAt: Date | string | null;
}

export type Refusal = { status: 400 | 409; error: string };

/** Signed and not unlocked → read-only. */
export function isIncidentLocked(r: IncidentLockState): boolean {
  return r.signedAt != null && r.signedAt !== "" && (r.unlockedAt == null || r.unlockedAt === "");
}

export const LOCKED_EDIT_ERROR =
  "This report is signed and locked, so it can't be changed. A manager can unlock it (with a reason) to update it — photos can still be added.";

/** Why an edit to the report's fields is refused, or null when allowed. */
export function incidentEditRefusal(r: IncidentLockState): Refusal | null {
  return isIncidentLocked(r) ? { status: 409, error: LOCKED_EDIT_ERROR } : null;
}

/** Why signing is refused, or null when allowed (unsigned, or unlocked). */
export function incidentSignRefusal(r: IncidentLockState): Refusal | null {
  return isIncidentLocked(r)
    ? { status: 409, error: "Already signed and locked. Unlock it first if something needs updating." }
    : null;
}

/** Why an unlock is refused, or null when allowed. */
export function incidentUnlockRefusal(r: IncidentLockState, reason: string | null | undefined): Refusal | null {
  if (!r.signedAt) return { status: 409, error: "This report isn't signed yet, so it's already open for editing." };
  if (r.unlockedAt) return { status: 409, error: "This report is already unlocked — update it, then sign it again." };
  if (!reason || !reason.trim()) return { status: 400, error: "Say briefly why it's being unlocked." };
  return null;
}

function isoOrNull(v: unknown): string | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

/** The content fields of a report (or a stored snapshot), normalised so
 *  two snapshots compare cleanly: timestamps as ISO strings, empty text as
 *  null, booleans as booleans. */
export function snapshotIncident(row: Partial<Record<IncidentContentKey, unknown>>): IncidentSnapshot {
  const out = {} as IncidentSnapshot;
  for (const f of INCIDENT_CONTENT_FIELDS) {
    const v = row[f.key];
    if (f.type === "bool") out[f.key] = Boolean(v);
    else if (f.type === "datetime") out[f.key] = isoOrNull(v);
    else out[f.key] = v == null || (typeof v === "string" && v.trim() === "") ? null : String(v);
  }
  return out;
}

export interface IncidentFieldChange {
  key: IncidentContentKey;
  label: string;
  type: IncidentFieldType;
  before: string | boolean | null;
  after: string | boolean | null;
}

/** Field-by-field differences between two snapshots, in form order. */
export function diffIncidentSnapshots(
  before: Partial<Record<IncidentContentKey, unknown>>,
  after: Partial<Record<IncidentContentKey, unknown>>,
): IncidentFieldChange[] {
  const a = snapshotIncident(before);
  const b = snapshotIncident(after);
  const changes: IncidentFieldChange[] = [];
  for (const f of INCIDENT_CONTENT_FIELDS) {
    if (a[f.key] !== b[f.key]) changes.push({ key: f.key, label: f.label, type: f.type, before: a[f.key], after: b[f.key] });
  }
  return changes;
}

export interface IncidentHistoryRow {
  id: number;
  event: string; // 'signed' | 'unlocked'
  version: number;
  snapshot: unknown;
  actorName: string | null;
  reason: string | null;
  createdAt: Date | string;
}

export interface IncidentHistoryEntry {
  id: number;
  event: "signed" | "unlocked";
  version: number;
  actorName: string | null;
  reason: string | null;
  at: string;
  /** Signed v2+: what changed since the previous signed version. Empty
   *  when re-signed unchanged; null for v1 and unlock rows. */
  changes: IncidentFieldChange[] | null;
}

/** The History section: events oldest first, each signed version after
 *  the first carrying its changes against the previous signed version. */
export function buildIncidentHistory(rows: IncidentHistoryRow[]): IncidentHistoryEntry[] {
  const sorted = [...rows].sort((x, y) => {
    const t = new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime();
    return t !== 0 ? t : x.id - y.id;
  });
  let lastSigned: Record<string, unknown> | null = null;
  const out: IncidentHistoryEntry[] = [];
  for (const r of sorted) {
    if (r.event !== "signed" && r.event !== "unlocked") continue;
    const snap = (r.snapshot && typeof r.snapshot === "object" ? r.snapshot : {}) as Record<string, unknown>;
    let changes: IncidentFieldChange[] | null = null;
    if (r.event === "signed") {
      changes = lastSigned ? diffIncidentSnapshots(lastSigned, snap) : null;
      lastSigned = snap;
    }
    out.push({
      id: r.id,
      event: r.event,
      version: r.version,
      actorName: r.actorName,
      reason: r.reason,
      at: isoOrNull(r.createdAt) ?? "",
      changes,
    });
  }
  return out;
}
