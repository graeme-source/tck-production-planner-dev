/**
 * The employment record — the rules (Graeme, 2026-10-12).
 *
 * "Reduce the number of options for recording something, but allow
 * classifications for that record to be the defining part, so it's really
 * simple and easy to use."
 *
 * So there is ONE thing: a record ENTRY, added with ONE form ("Add to
 * record"). Its CLASSIFICATION (Performance appraisal, Probation review,
 * Disciplinary, Attendance, Timekeeping, Health…) is an editable list, and
 * each classification switches on a few extra FIELD SETS — data, not name
 * matching, so a new classification can reuse any of them:
 *
 *   stage     Stage ladder (informal discussion → … → dismissal), warning
 *             expiry, and the formal-hearing checklist (ACAS Code)
 *   rating    Below / Meets / Exceeds expectations
 *   pay       Pay change: from → to, effective date
 *   probation Passed · Extended (new end date) · Not passed
 *   fitness   Fit for work: Yes / No / Referred to occupational health
 *
 * Any entry can be "Open — in review" until it's closed; the person's badge
 * shows the most serious OPEN entry. Changing an entry's classification
 * keeps every value it already holds — fields the new classification
 * doesn't use are hidden, never deleted, and come back if it's changed back.
 *
 * Pure and shared by the API (routes/people-reviews.ts) and the app
 * (components/people/*), so what the list shows and what the server
 * enforces can't drift apart.
 */

import type { MeetingStatus } from "./reviews";

// ── Field sets and classifications ─────────────────────────────────────────

export const FIELD_SETS = ["stage", "rating", "pay", "probation", "fitness"] as const;
export type FieldSet = (typeof FIELD_SETS)[number];

export const FIELD_SET_LABEL: Record<FieldSet, string> = {
  stage: "Stage & warnings",
  rating: "Rating",
  pay: "Pay change",
  probation: "Probation outcome",
  fitness: "Fit for work",
};

/** Which attendance figures to show as evidence on an entry. */
export const EVIDENCE_KINDS = ["attendance", "timekeeping"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface Classification {
  id: number;
  label: string;
  /** Order in the picker. */
  sortOrder: number;
  fieldSets: FieldSet[];
  evidence: EvidenceKind | null;
  active: boolean;
  /** What a newly scheduled meeting starts as (migration 0182). */
  defaultForMeetings?: boolean;
}

/** The seeded list (migration 0170 inserts exactly this), in Graeme's order. */
export const SEED_CLASSIFICATIONS: ReadonlyArray<Omit<Classification, "id">> = [
  { label: "Performance appraisal", sortOrder: 10, fieldSets: ["rating", "pay"], evidence: null, active: true },
  { label: "Probation review", sortOrder: 20, fieldSets: ["rating", "pay", "probation"], evidence: null, active: true },
  { label: "Disciplinary", sortOrder: 30, fieldSets: ["stage"], evidence: null, active: true },
  { label: "Attendance", sortOrder: 40, fieldSets: ["stage"], evidence: "attendance", active: true },
  { label: "Timekeeping", sortOrder: 50, fieldSets: ["stage"], evidence: "timekeeping", active: true },
  { label: "Health / fitness for work", sortOrder: 60, fieldSets: ["fitness"], evidence: null, active: true },
  { label: "Grievance (raised by the employee)", sortOrder: 70, fieldSets: [], evidence: null, active: true },
  { label: "Praise / recognition", sortOrder: 80, fieldSets: [], evidence: null, active: true },
  { label: "Training & qualifications", sortOrder: 90, fieldSets: [], evidence: null, active: true },
  { label: "Contract change (role, hours, pay)", sortOrder: 100, fieldSets: ["pay"], evidence: null, active: true },
  { label: "Other", sortOrder: 110, fieldSets: [], evidence: null, active: true },
];

export function sortClassifications<C extends Pick<Classification, "sortOrder" | "id">>(list: readonly C[]): C[] {
  return [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

/** Only known field sets, each once — what the server stores. */
export function cleanFieldSets(raw: readonly string[]): FieldSet[] {
  const known = new Set<string>(FIELD_SETS);
  return FIELD_SETS.filter(f => raw.includes(f) && known.has(f));
}

export function usesField(c: Pick<Classification, "fieldSets"> | null | undefined, f: FieldSet): boolean {
  return !!c && c.fieldSets.includes(f);
}

// ── Vocabulary ─────────────────────────────────────────────────────────────

export const RATINGS = ["below", "meets", "exceeds"] as const;
export type Rating = (typeof RATINGS)[number];
export const RATING_LABEL: Record<Rating, string> = {
  below: "Below expectations",
  meets: "Meets expectations",
  exceeds: "Exceeds expectations",
};

export const PROBATION_OUTCOMES = ["passed", "extended", "not_passed"] as const;
export type ProbationOutcome = (typeof PROBATION_OUTCOMES)[number];
export const PROBATION_OUTCOME_LABEL: Record<ProbationOutcome, string> = {
  passed: "Passed",
  extended: "Extended",
  not_passed: "Not passed",
};

export const FIT_FOR_WORK = ["yes", "no", "oh_referral"] as const;
export type FitForWork = (typeof FIT_FOR_WORK)[number];
export const FIT_FOR_WORK_LABEL: Record<FitForWork, string> = {
  yes: "Fit for work",
  no: "Not fit for work",
  oh_referral: "Referred to occupational health",
};

export const ENTRY_STATUSES = ["open", "closed"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const MEETING_TYPES = ["informal_chat", "review", "investigation", "disciplinary", "appeal"] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];
export const MEETING_TYPE_LABEL: Record<MeetingType, string> = {
  informal_chat: "Informal chat",
  review: "Review meeting",
  investigation: "Investigation meeting",
  disciplinary: "Disciplinary hearing",
  appeal: "Appeal hearing",
};

/** What a stage IS — behaviour hangs off this, never off its label.
 *  discussion · plan (targets + a review date) · warning (has an expiry) ·
 *  outcome (a recorded end such as dismissal — the app never acts on it). */
export const STAGE_TYPES = ["discussion", "plan", "warning", "outcome"] as const;
export type StageType = (typeof STAGE_TYPES)[number];

export interface Stage {
  id: number;
  label: string;
  /** Seriousness: higher = more serious. Also the order on screen. */
  rank: number;
  type: StageType;
  /** Part of the formal disciplinary/capability process. */
  formal: boolean;
  /** Warnings only: default months until it expires. */
  defaultExpiryMonths: number | null;
  /** e.g. ACAS doesn't require a verbal warning stage. */
  optional: boolean;
  active: boolean;
}

/** The seeded ladder (migration 0170 inserts exactly this). */
export const SEED_STAGES: ReadonlyArray<Omit<Stage, "id">> = [
  { label: "Informal discussion", rank: 10, type: "discussion", formal: false, defaultExpiryMonths: null, optional: false, active: true },
  { label: "Improvement plan", rank: 20, type: "plan", formal: false, defaultExpiryMonths: null, optional: true, active: true },
  { label: "Verbal warning", rank: 30, type: "warning", formal: true, defaultExpiryMonths: 6, optional: true, active: true },
  { label: "First written warning", rank: 40, type: "warning", formal: true, defaultExpiryMonths: 12, optional: false, active: true },
  { label: "Final written warning", rank: 50, type: "warning", formal: true, defaultExpiryMonths: 12, optional: false, active: true },
  { label: "Dismissal", rank: 60, type: "outcome", formal: true, defaultExpiryMonths: null, optional: false, active: true },
];

export function sortStages<S extends Pick<Stage, "rank" | "id">>(stages: readonly S[]): S[] {
  return [...stages].sort((a, b) => a.rank - b.rank || a.id - b.id);
}

/** The next stage up from `currentStageId` (skipping turned-off stages and
 *  recorded outcomes such as dismissal — those are only ever chosen on
 *  purpose). Null = nowhere further to go. */
export function nextStage(currentStageId: number | null, stages: readonly Stage[]): Stage | null {
  const ordered = sortStages(stages.filter(s => s.active && s.type !== "outcome"));
  const current = currentStageId != null ? stages.find(s => s.id === currentStageId) : undefined;
  const rank = current?.rank ?? -Infinity;
  return ordered.find(s => s.rank > rank) ?? null;
}

// ── Dates (ISO YYYY-MM-DD; calendar maths in UTC so no clock shifts) ──────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Today in London (the kitchen's day). */
export function londonTodayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Same day `months` later, clamped to the month's last day. */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const idx = (m - 1) + months;
  const ty = y + Math.floor(idx / 12);
  const tm = ((idx % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ty, tm, Math.min(d, last))).toISOString().slice(0, 10);
}

/** "11 Apr 2027". */
export function fmtDayIso(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// ── Entries ────────────────────────────────────────────────────────────────

export interface EntryLike {
  id: number;
  /** The PRIMARY classification (the first ticked). */
  classificationId: number;
  /** Every classification ticked, primary first (migration 0184). Absent or
   *  empty = just the primary. Read through entryClassIds. */
  classificationIds?: readonly number[] | null;
  entryDate: string;
  title: string;
  status: EntryStatus;
  stageId: number | null;
  /** Last live day of the warning, when the stage is a warning. */
  warningExpiresOn: string | null;
  warningWithdrawnAt: string | null;
}

function byId<T extends { id: number }>(list: readonly T[]): Map<number, T> {
  return new Map(list.map(x => [x.id, x]));
}

// ── More than one classification (Graeme, 2026-10-12: "It could be about
// attendance and timekeeping… we should be [able to tick a] number of
// classifications") ─────────────────────────────────────────────────────────
//
// An entry keeps ONE primary classification (people_record_entries
// .classification_id — the first ticked) and the full ticked set in
// people_record_entry_classifications (migration 0184). Everything that asks
// "what is this entry about?" reads the SET through these two helpers, so a
// review about attendance AND disciplinary gets the stage ladder, the
// formal rules, the attendance evidence — anything any of them switches on.

type ClassRef = { classificationId: number; classificationIds?: readonly number[] | null };

/** The entry's classifications: primary first, each once. */
export function entryClassIds(e: ClassRef): number[] {
  return [...new Set([e.classificationId, ...(e.classificationIds ?? [])])];
}

/** A ticked set as sent by a picker: whole positive ids, each once, in the
 *  order ticked (the first is the primary). */
export function cleanClassIds(raw: readonly number[]): number[] {
  return [...new Set(raw.filter(n => Number.isInteger(n) && n > 0))];
}

/** Tick or untick one in a picker: ticking adds at the end (so the first
 *  ticked stays the primary), and the last one can't be unticked. */
export function toggleClassId(ids: readonly number[], id: number): number[] {
  if (ids.includes(id)) return ids.length > 1 ? ids.filter(x => x !== id) : [...ids];
  return [...ids, id];
}

/** Attendance covers sickness and lates, so it outranks timekeeping. */
export function combinedEvidence(list: ReadonlyArray<string | null | undefined>): EvidenceKind | null {
  if (list.includes("attendance")) return "attendance";
  if (list.includes("timekeeping")) return "timekeeping";
  return null;
}

/** The entry's classifications merged into one: the field sets and
 *  evidence of ANY of them, labelled "Attendance + Disciplinary". The id is
 *  the primary's. Undefined when none of them exists. */
export function entryClassification(e: ClassRef, classifications: readonly Classification[]): Classification | undefined {
  const map = byId(classifications);
  const list = entryClassIds(e).map(id => map.get(id)).filter((c): c is Classification => !!c);
  if (list.length === 0) return undefined;
  if (list.length === 1) return list[0];
  const sets = new Set(list.flatMap(c => c.fieldSets));
  return {
    id: list[0].id,
    label: list.map(c => c.label).join(" + "),
    sortOrder: list[0].sortOrder,
    fieldSets: FIELD_SETS.filter(f => sets.has(f)),
    evidence: combinedEvidence(list.map(c => c.evidence)),
    active: list.some(c => c.active),
  };
}

/** Each of the entry's classifications, primary first — for chips. */
export function entryClassLabels(e: ClassRef, classifications: readonly Classification[]): string[] {
  const map = byId(classifications);
  return entryClassIds(e).map(id => map.get(id)?.label).filter((l): l is string => !!l);
}

/** The stage that counts for this entry — only if one of its
 *  classifications uses stages. A stage kept from before a reclassification
 *  is hidden, not live. */
export function effectiveStage(e: Pick<EntryLike, "classificationId" | "classificationIds" | "stageId">, classifications: readonly Classification[], stages: readonly Stage[]): Stage | null {
  if (e.stageId == null) return null;
  if (!usesField(entryClassification(e, classifications), "stage")) return null;
  return byId(stages).get(e.stageId) ?? null;
}

// ── Warnings ───────────────────────────────────────────────────────────────

/** Last live day: issued + N months, less a day — a 6-month verbal issued
 *  12 Oct 2026 is live until 11 Apr 2027. */
export function defaultWarningExpiry(issuedOn: string, months: number): string {
  return addDaysIso(addMonthsIso(issuedOn, months), -1);
}

export interface WarningLike { issuedOn: string; expiresOn: string; withdrawnAt?: string | null }
export type WarningState = "live" | "expired" | "withdrawn";

export function warningState(w: WarningLike, todayIso: string): WarningState {
  if (w.withdrawnAt) return "withdrawn";
  return todayIso <= w.expiresOn.slice(0, 10) ? "live" : "expired";
}

export function warningStatusLabel(w: WarningLike, todayIso: string): string {
  const s = warningState(w, todayIso);
  if (s === "withdrawn") return "Withdrawn";
  if (s === "live") return `Live until ${fmtDayIso(w.expiresOn)}`;
  return `Expired ${fmtDayIso(addDaysIso(w.expiresOn, 1))}`;
}

export function checkWarningDates(issuedOn: string, expiresOn: string): string | null {
  return expiresOn < issuedOn ? "The expiry can't be before the date it was issued." : null;
}

/** The entry as a warning, if it is one: a warning-type stage that its
 *  classification uses, with an expiry. */
export function entryWarning(e: EntryLike, classifications: readonly Classification[], stages: readonly Stage[]): (WarningLike & { stage: Stage }) | null {
  const stage = effectiveStage(e, classifications, stages);
  if (!stage || stage.type !== "warning" || !e.warningExpiresOn) return null;
  return { issuedOn: e.entryDate, expiresOn: e.warningExpiresOn, withdrawnAt: e.warningWithdrawnAt, stage };
}

/** The live warning that runs longest — shown on the list even when the
 *  entry it came from is closed. */
export function longestLiveWarning<W extends WarningLike>(warnings: readonly W[], todayIso: string): W | null {
  let best: W | null = null;
  for (const w of warnings) {
    if (warningState(w, todayIso) !== "live") continue;
    if (!best || w.expiresOn > best.expiresOn) best = w;
  }
  return best;
}

/** The expiry to store when a stage is picked: keep one already set, fill
 *  the stage's default for a warning, clear it for anything else. */
export function expiryForStage(stage: Stage | null, entryDate: string, current: string | null): string | null {
  if (!stage || stage.type !== "warning") return current; // kept, just not used
  return current ?? defaultWarningExpiry(entryDate, stage.defaultExpiryMonths ?? 12);
}

// ── In review: level, seriousness, the badge ───────────────────────────────

export type ReviewLevel = "none" | "informal" | "formal";

export function entryLevel(e: EntryLike, classifications: readonly Classification[], stages: readonly Stage[]): ReviewLevel {
  if (e.status !== "open") return "none";
  return effectiveStage(e, classifications, stages)?.formal ? "formal" : "informal";
}

/** Bigger = more serious; -1 = not open. Formal outranks informal, then the
 *  stage's rank; an open entry with no stage is the least serious. */
export function entrySeverity(e: EntryLike, classifications: readonly Classification[], stages: readonly Stage[]): number {
  const level = entryLevel(e, classifications, stages);
  if (level === "none") return -1;
  const stage = effectiveStage(e, classifications, stages);
  return (level === "formal" ? 100_000 : 0) + (stage?.rank ?? 0);
}

/** Most serious OPEN entry; ties go to the older one. */
export function mostSeriousEntry<E extends EntryLike>(entries: readonly E[], classifications: readonly Classification[], stages: readonly Stage[]): E | null {
  let best: E | null = null;
  let bestSev = -1;
  for (const e of entries) {
    const sev = entrySeverity(e, classifications, stages);
    if (sev < 0) continue;
    if (!best || sev > bestSev || (sev === bestSev && (e.entryDate < best.entryDate || (e.entryDate === best.entryDate && e.id < best.id)))) {
      best = e; bestSev = sev;
    }
  }
  return best;
}

export interface ReviewBadge {
  level: Exclude<ReviewLevel, "none">;
  /** "In review · Timekeeping" / "Formal · Verbal warning · Attendance" */
  label: string;
  entryId: number;
  /** Other open entries besides the one named. */
  otherOpen: number;
}

export function entryHeadline(e: EntryLike, classifications: readonly Classification[], stages: readonly Stage[]): string {
  const cls = entryClassification(e, classifications)?.label ?? "Record";
  const level = entryLevel(e, classifications, stages);
  if (level === "none") return cls;
  if (level === "informal") return `In review · ${cls}`;
  return `Formal · ${effectiveStage(e, classifications, stages)?.label ?? "Formal process"} · ${cls}`;
}

export function reviewBadge(entries: readonly EntryLike[], classifications: readonly Classification[], stages: readonly Stage[]): ReviewBadge | null {
  const top = mostSeriousEntry(entries, classifications, stages);
  if (!top) return null;
  return {
    level: entryLevel(top, classifications, stages) as ReviewBadge["level"],
    label: entryHeadline(top, classifications, stages),
    entryId: top.id,
    otherOpen: entries.filter(e => e.status === "open").length - 1,
  };
}

// ── Reclassification ───────────────────────────────────────────────────────

export interface Reclassification {
  /** "Reclassified from Attendance to Disciplinary" */
  message: string;
  /** Field sets the old one showed and the new one hides — values kept. */
  hidden: FieldSet[];
  /** Field sets the new one shows that the old one didn't. */
  shown: FieldSet[];
  /** Field sets both use — values carry straight over. */
  kept: FieldSet[];
}

/** What changing an entry's classification does. Nothing is deleted: the
 *  server stores every value regardless, and the screen shows only the
 *  field sets the current classification uses. */
export function reclassify(from: Classification | undefined, to: Classification): Reclassification {
  const before = from?.fieldSets ?? [];
  return {
    message: `Reclassified from ${from?.label ?? "an old classification"} to ${to.label}`,
    hidden: before.filter(f => !to.fieldSets.includes(f)),
    shown: to.fieldSets.filter(f => !before.includes(f)),
    kept: before.filter(f => to.fieldSets.includes(f)),
  };
}

// ── Access ─────────────────────────────────────────────────────────────────
//
// WHO may read or write someone's record is NOT decided here: it is the one
// shared rule, canWriteEmploymentRecord (api-server lib/people-write-access.ts
// — the founder always; a People-data grant holder except on their own
// record, matched by account, email or Planday id). The server applies it to
// every read and, through the employmentRecordWrite guard, every write.

/** Editing the classification and stage LISTS (not anyone's record): the
 *  founder, or an admin with People access. */
export function canEditLists(v: { hasPeopleAccess: boolean; role: string | null; isFounder?: boolean }): boolean {
  return v.isFounder === true || (v.hasPeopleAccess && v.role === "admin");
}

// ── Evidence from attendance ───────────────────────────────────────────────

export interface AttendanceFacts {
  sickInstances: number;
  sickDays: number;
  lates: number;
  otherAbsenceDays: number;
  triggers: { sickness: boolean; lates: boolean };
  policy: { sickInstances: number; lates: number; months: number };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The trigger summary for an entry whose classification asks for it. */
export function evidenceLine(kind: EvidenceKind | null, a: AttendanceFacts | null): { text: string; triggered: boolean } | null {
  if (!kind || !a) return null;
  const months = `${a.policy.months} months`;
  if (kind === "attendance") {
    const other = a.otherAbsenceDays > 0 ? `, plus ${plural(a.otherAbsenceDays, "day")} of other absence` : "";
    return {
      text: `${plural(a.sickInstances, "sickness instance")} (${plural(a.sickDays, "day")})${other} in the last ${months}. Review trigger: ${a.policy.sickInstances} instances.`,
      triggered: a.triggers.sickness,
    };
  }
  return {
    text: `${plural(a.lates, "late")} in the last ${months}. Review trigger: ${a.policy.lates} lates.`,
    triggered: a.triggers.lates,
  };
}

// ── Formal meeting reminders (ACAS Code) ───────────────────────────────────

export interface ChecklistItem { key: string; label: string }

/** Hearings with the statutory right to be accompanied. */
export function isFormalHearing(type: MeetingType | null | undefined): boolean {
  return type === "disciplinary" || type === "appeal";
}

export function meetingChecklist(type: MeetingType | null | undefined): ChecklistItem[] {
  if (type === "disciplinary") {
    return [
      { key: "written_notice", label: "Written notice sent — what the problem is and what could happen (e.g. a warning)" },
      { key: "evidence_sent", label: "Copies of the evidence sent with the notice" },
      { key: "time_to_prepare", label: "Date, time and place given, with reasonable time to prepare" },
      { key: "right_to_accompany", label: "Told them they can bring a colleague or trade union rep" },
      { key: "note_taker", label: "Someone else lined up to take notes" },
    ];
  }
  if (type === "appeal") {
    return [
      { key: "written_notice", label: "Written notice of the appeal hearing sent" },
      { key: "right_to_accompany", label: "Told them they can bring a colleague or trade union rep" },
      { key: "impartial", label: "Heard by someone not involved before, where possible" },
      { key: "note_taker", label: "Someone else lined up to take notes" },
    ];
  }
  if (type === "investigation") {
    return [
      { key: "explained_not_disciplinary", label: "Told them it's fact-finding, not a disciplinary" },
      { key: "note_taker", label: "Someone else lined up to take notes" },
    ];
  }
  return [];
}

export function cleanChecklist(type: MeetingType | null | undefined, keys: readonly string[]): string[] {
  const allowed = new Set(meetingChecklist(type).map(i => i.key));
  return [...new Set(keys.filter(k => allowed.has(k)))];
}

// ── To-dos (meeting day, next review date) ─────────────────────────────────

/** meeting = the booked day; review = the next-review date; action = a
 *  follow-up action from a meeting's notes that is the booker's own. */
export type TodoKind = "meeting" | "review" | "action";

export interface TodoInput {
  kind: TodoKind;
  ownerId: number;
  ownerName: string;
  subjectUserId: number;
  subjectName: string;
  entryId: number;
  date: string;
  time?: string | null;
}

/** A to-do on the BOOKER's own list for the day, linking back to the entry.
 *  No personal information at all (Graeme, 2026-10-12: "We don't say,
 *  'Naomi's review is coming up.' We just say, 'Your attention is required
 *  in HR'") — not even a first name, since other managers can open to-do
 *  lists. The details sit behind the People PIN. Nothing is ever sent to
 *  the employee. */
export function recordTodo(i: TodoInput) {
  return {
    assigneeId: i.ownerId,
    createdBy: i.ownerId,
    createdByName: i.ownerName,
    title: i.kind === "meeting"
      ? `HR meeting${i.time ? ` at ${i.time}` : ""} — tap here`
      : i.kind === "action" ? "HR action due — tap here"
      : "HR follow-up due — tap here",
    notes: "Details are in HR (private — needs your People PIN).",
    url: `/people/${i.subjectUserId}?entry=${i.entryId}`,
    priority: "high" as const,
    scheduledFor: i.date,
    dueDate: i.date,
  };
}

export type TodoAction = "none" | "create" | "update" | "cancel";

/** What to do to an entry's linked to-do when its date (and time) changes.
 *  A to-do is only ever MADE when asked for (`mayCreate` — Graeme, 30 Oct
 *  2026: "by default, I don't want to add anything to my to-do list… I have
 *  to take action to add it"); one already made still moves and closes. */
export function planTodo(
  prev: { todoId: number | null; date: string | null; time?: string | null },
  next: { date: string | null; time?: string | null },
  mayCreate: boolean,
): TodoAction {
  if (!next.date) return prev.todoId != null ? "cancel" : "none";
  if (prev.todoId == null) return mayCreate ? "create" : "none";
  return prev.date === next.date && (prev.time ?? null) === (next.time ?? null) ? "none" : "update";
}

// ── The record's timeline + filters ────────────────────────────────────────

export type RecordEventKind = "entry" | "meeting" | "warning_expired" | "closed" | "reclassified";

export interface RecordEvent {
  key: string;
  date: string;
  kind: RecordEventKind;
  entryId: number;
  title: string;
  detail: string | null;
}

export interface TimelineEntry extends EntryLike {
  closedOn: string | null;
  meetingType: MeetingType | null;
  /** The review's status (migration 0178); a cancelled one has no meeting event. */
  meetingStatus?: MeetingStatus | null;
  meetingDate: string | null;
  meetingTime: string | null;
  /** From the entry's history: reclassifications, with the day they happened. */
  reclassifications?: Array<{ at: string; message: string }>;
}

export function recordTimelineEvents(entries: readonly TimelineEntry[], classifications: readonly Classification[], stages: readonly Stage[], todayIso: string): RecordEvent[] {
  const out: RecordEvent[] = [];
  for (const e of entries) {
    const label = entryClassification(e, classifications)?.label ?? "Record";
    const stage = effectiveStage(e, classifications, stages);
    const w = entryWarning(e, classifications, stages);
    const bits = [stage?.label, e.status === "open" ? "Open — in review" : null, w ? warningStatusLabel(w, todayIso) : null].filter(Boolean);
    out.push({
      key: `re-${e.id}`, date: e.entryDate, kind: "entry", entryId: e.id,
      title: `${label}${e.title ? `: ${e.title}` : ""}`, detail: bits.length ? bits.join(" · ") : null,
    });
    // A review's meeting: any with a date that isn't cancelled. The ACAS
    // meeting type, when given, names it; otherwise it's just "Review".
    if (e.meetingDate && (e.meetingType || e.meetingStatus) && e.meetingStatus !== "cancelled") {
      out.push({
        key: `re-${e.id}-m`, date: e.meetingDate, kind: "meeting", entryId: e.id,
        title: `${e.meetingType ? MEETING_TYPE_LABEL[e.meetingType] : "Review"} · ${label}`, detail: e.meetingTime ? `At ${e.meetingTime}` : null,
      });
    }
    if (w && warningState(w, todayIso) === "expired") {
      out.push({ key: `re-${e.id}-we`, date: addDaysIso(w.expiresOn, 1), kind: "warning_expired", entryId: e.id, title: `${w.stage.label} expired · ${label}`, detail: null });
    }
    if (e.status === "closed" && e.closedOn) {
      out.push({ key: `re-${e.id}-c`, date: e.closedOn, kind: "closed", entryId: e.id, title: `Review closed · ${label}`, detail: null });
    }
    (e.reclassifications ?? []).forEach((r, i) => {
      out.push({ key: `re-${e.id}-rc-${i}`, date: r.at.slice(0, 10), kind: "reclassified", entryId: e.id, title: r.message, detail: null });
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.key.localeCompare(a.key));
}

/** Entries newest first, optionally only those ticked with one classification. */
export function filterEntries<E extends Pick<EntryLike, "classificationId" | "classificationIds" | "entryDate" | "id">>(entries: readonly E[], classificationId: number | null): E[] {
  return entries
    .filter(e => classificationId == null || entryClassIds(e).includes(classificationId))
    .sort((a, b) => b.entryDate.localeCompare(a.entryDate) || b.id - a.id);
}

/** Filter chips: only classifications that have entries, in list order. An
 *  entry with several classifications counts under each. */
export function classificationCounts(entries: ReadonlyArray<Pick<EntryLike, "classificationId" | "classificationIds">>, classifications: readonly Classification[]): Array<{ id: number; label: string; count: number }> {
  const counts = new Map<number, number>();
  for (const e of entries) for (const id of entryClassIds(e)) counts.set(id, (counts.get(id) ?? 0) + 1);
  return sortClassifications(classifications)
    .filter(c => (counts.get(c.id) ?? 0) > 0)
    .map(c => ({ id: c.id, label: c.label, count: counts.get(c.id)! }));
}

// ── Letters ────────────────────────────────────────────────────────────────
//
// "The ability, where appropriate, to generate letters and send them to
// employees to inform them of important updates such as written warnings."
// Templates are an editable list; WHICH are offered for an entry is data on
// each template (the field set its classification must use, a stage or
// stage type, a probation outcome, needs a meeting / a pay change) — never a
// name match. Sending is never automatic.

export interface LetterTemplate {
  id: number;
  key: string;
  title: string;
  body: string;
  /** Offered only if the entry's classification uses this field set. */
  fieldSet: FieldSet | null;
  /** Offered only at this exact stage… */
  stageId: number | null;
  /** …or at any stage of this type. */
  stageType: StageType | null;
  /** Offered only for this probation outcome. */
  probationOutcome: ProbationOutcome | null;
  requiresMeeting: boolean;
  requiresPay: boolean;
  sortOrder: number;
  active: boolean;
}

export interface LetterEntryFacts {
  classificationId: number;
  /** Every classification ticked (0184) — any formal one brings its letters. */
  classificationIds?: readonly number[] | null;
  stageId: number | null;
  probationOutcome: ProbationOutcome | null;
  meetingDate: string | null;
  payTo: string | null;
}

/** The templates that fit this entry, in list order. */
export function templatesForEntry<T extends LetterTemplate>(
  e: LetterEntryFacts, classifications: readonly Classification[], stages: readonly Stage[], templates: readonly T[],
): T[] {
  const cls = entryClassification(e, classifications);
  const stage = effectiveStage(e, classifications, stages);
  return [...templates]
    .filter(t => t.active)
    .filter(t => t.fieldSet == null || usesField(cls, t.fieldSet))
    .filter(t => t.stageId == null || stage?.id === t.stageId)
    .filter(t => t.stageType == null || stage?.type === t.stageType)
    .filter(t => t.probationOutcome == null || (usesField(cls, "probation") && e.probationOutcome === t.probationOutcome))
    .filter(t => !t.requiresMeeting || !!e.meetingDate)
    .filter(t => !t.requiresPay || (usesField(cls, "pay") && !!e.payTo?.trim()))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

/** Every merge field a template can use, with what it means. */
export const MERGE_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "date", label: "Today's date (the letter's date)" },
  { key: "firstName", label: "Their first name" },
  { key: "fullName", label: "Their full name" },
  { key: "classification", label: "What the entry is (e.g. Timekeeping)" },
  { key: "reason", label: "The entry's summary" },
  { key: "outcome", label: "The entry's outcome — e.g. what must improve" },
  { key: "stage", label: "The stage, e.g. first written warning" },
  { key: "expiryDate", label: "When the warning stops being live" },
  { key: "reviewDate", label: "The next review date" },
  { key: "meetingType", label: "The kind of meeting" },
  { key: "meetingDate", label: "The meeting's date" },
  { key: "meetingTime", label: "The meeting's time" },
  { key: "companionRight", label: "The right-to-be-accompanied paragraph" },
  { key: "appealBy", label: "The appeal deadline (7 days from the letter)" },
  { key: "payFrom", label: "Pay before" },
  { key: "payTo", label: "Pay after" },
  { key: "effectiveDate", label: "When the pay change starts" },
  { key: "probationOutcome", label: "passed / extended / not passed" },
  { key: "newEndDate", label: "New probation end date" },
  { key: "signatoryName", label: "Who signs the letter" },
  { key: "signature", label: "Graeme's signature (only when Graeme signs)" },
];

export const COMPANION_RIGHT =
  "You have the right to be accompanied at this meeting by a work colleague or a trade union representative. Please let me know before the meeting who you would like to bring.";

/** The marker the contract PDF renderer turns into Graeme's signature. */
export const FOUNDER_SIGNATURE_MARKER = "[[founder_signature]]";

/** Days from the letter's date to the appeal deadline. */
export const APPEAL_DAYS = 7;

export interface LetterContext {
  todayIso: string;
  personName: string;
  classificationLabel: string;
  entry: {
    title: string;
    outcome: string | null;
    stageLabel: string | null;
    warningExpiresOn: string | null;
    nextReviewDate: string | null;
    meetingType: MeetingType | null;
    meetingDate: string | null;
    meetingTime: string | null;
    payFrom: string | null;
    payTo: string | null;
    payEffectiveOn: string | null;
    probationOutcome: ProbationOutcome | null;
    probationNewEnd: string | null;
  };
  signatoryName: string;
  signatoryIsFounder: boolean;
}

/** Values for every merge field; "" where the entry has nothing. */
export function letterMergeValues(c: LetterContext): Record<string, string> {
  const e = c.entry;
  return {
    date: fmtDayIso(c.todayIso),
    firstName: c.personName.trim().split(/\s+/)[0] ?? "",
    fullName: c.personName.trim(),
    classification: c.classificationLabel,
    reason: e.title.trim(),
    outcome: (e.outcome ?? "").trim(),
    stage: e.stageLabel ? e.stageLabel.toLowerCase() : "",
    expiryDate: fmtDayIso(e.warningExpiresOn),
    reviewDate: fmtDayIso(e.nextReviewDate),
    meetingType: e.meetingType ? MEETING_TYPE_LABEL[e.meetingType].toLowerCase() : "",
    meetingDate: fmtDayIso(e.meetingDate),
    meetingTime: e.meetingTime ?? "",
    companionRight: COMPANION_RIGHT,
    appealBy: fmtDayIso(addDaysIso(c.todayIso, APPEAL_DAYS)),
    payFrom: e.payFrom ?? "",
    payTo: e.payTo ?? "",
    effectiveDate: fmtDayIso(e.payEffectiveOn),
    probationOutcome: e.probationOutcome ? PROBATION_OUTCOME_LABEL[e.probationOutcome].toLowerCase() : "",
    newEndDate: fmtDayIso(e.probationNewEnd),
    signatoryName: c.signatoryName,
    signature: c.signatoryIsFounder ? FOUNDER_SIGNATURE_MARKER : "",
  };
}

/** Fill {fields}. A field with no value is left as a visible [gap] for the
 *  author to fill before sending; unknown {words} are left as they are. */
export function fillTemplate(body: string, values: Record<string, string>): { text: string; gaps: string[] } {
  const gaps = new Set<string>();
  const text = body.replace(/\{([a-zA-Z]+)\}/g, (whole, key: string) => {
    if (!(key in values)) return whole;
    const v = values[key];
    if (v === "" && key !== "signature") { gaps.add(key); return `[${key}]`; }
    return v;
  });
  return { text, gaps: [...gaps] };
}

/** Gaps still in a letter — "[reviewDate]" etc. — checked before filing. */
export function letterGaps(text: string): string[] {
  const known = new Set(MERGE_FIELDS.map(f => f.key));
  return [...new Set([...text.matchAll(/\[([a-zA-Z]+)\]/g)].map(m => m[1]).filter(k => known.has(k)))];
}

export const LETTER_STATUSES = ["draft", "filed", "sent"] as const;
export type LetterStatus = (typeof LETTER_STATUSES)[number];
export type LetterAction = "edit" | "file" | "send" | "read" | "acknowledge";

/** draft → filed (the PDF is on their record, not shared) → sent (shared
 *  with them, maybe emailed) → read → acknowledged. Wording fixed once filed. */
export function checkLetterAction(l: { status: LetterStatus; acknowledgedAt: string | null }, action: LetterAction):
  { ok: true } | { ok: false; error: string } {
  switch (action) {
    case "edit":
    case "file":
      return l.status === "draft" ? { ok: true } : { ok: false, error: "This letter is already on their record — its wording is fixed." };
    case "send":
      return l.status === "sent" ? { ok: false, error: "This letter has already been sent." } : { ok: true };
    case "read":
      return l.status === "sent" ? { ok: true } : { ok: false, error: "No such letter" };
    case "acknowledge":
      if (l.status !== "sent") return { ok: false, error: "No such letter" };
      return l.acknowledgedAt ? { ok: false, error: "Already acknowledged." } : { ok: true };
  }
}

export function letterStatusLabel(l: { status: LetterStatus; sentAt: string | null; readAt: string | null; acknowledgedAt: string | null }): string {
  if (l.status === "draft") return "Draft";
  if (l.status === "filed") return "On their record — not sent";
  if (l.acknowledgedAt) return `Read and acknowledged ${fmtDayIso(l.acknowledgedAt)}`;
  if (l.readAt) return `Opened ${fmtDayIso(l.readAt)} — not acknowledged yet`;
  return `Sent ${fmtDayIso(l.sentAt)} — not opened yet`;
}

// ── Who letter emails come from ────────────────────────────────────────────
//
// "A letter is waiting" emails come from an HR identity, with replies going
// to a person Graeme chooses. The from-address is always on the app's
// already-verified sending domain (the domain of FROM_EMAIL — today the
// notify. subdomain); only the part before the @ can change, so an email can
// never be sent from an unverified domain.

export interface HrEmailSettings {
  fromName: string | null;
  fromLocal: string | null;
  replyTo: string | null;
}

export const HR_DEFAULT_FROM_NAME = "The Calzone Kitchen HR";
export const HR_DEFAULT_FROM_LOCAL = "hr";

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const LOCAL_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

export function isEmailAddress(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

/** Check what Graeme typed; null = fine. */
export function checkHrEmailSettings(s: Partial<HrEmailSettings>): string | null {
  if (s.fromLocal != null && s.fromLocal.trim() !== "" && !LOCAL_RE.test(s.fromLocal.trim().toLowerCase())) {
    return "The sending name can only use letters, numbers, dots, dashes and underscores (e.g. hr).";
  }
  if (s.replyTo != null && s.replyTo.trim() !== "" && !isEmailAddress(s.replyTo)) {
    return "Replies-to needs to be an email address.";
  }
  if (s.fromName != null && /[<>"\r\n]/.test(s.fromName)) return "The display name can't contain < > \" or line breaks.";
  return null;
}

/** The headers every HR letter email uses, and the line the send
 *  confirmation shows. `verifiedFrom` is the app's FROM_EMAIL. */
export function hrEmailIdentity(s: HrEmailSettings, verifiedFrom: string, founderEmail: string) {
  const domain = verifiedFrom.includes("@") ? verifiedFrom.split("@").pop()!.trim().toLowerCase() : verifiedFrom.trim().toLowerCase();
  const local = (s.fromLocal?.trim().toLowerCase() || HR_DEFAULT_FROM_LOCAL);
  const fromName = s.fromName?.trim() || HR_DEFAULT_FROM_NAME;
  const fromEmail = `${LOCAL_RE.test(local) ? local : HR_DEFAULT_FROM_LOCAL}@${domain}`;
  const replyTo = s.replyTo?.trim() && isEmailAddress(s.replyTo) ? s.replyTo.trim() : founderEmail;
  return { fromName, fromEmail, replyTo, line: `From: ${fromName} <${fromEmail}> · Replies go to: ${replyTo}` };
}

/** The email saying a letter is waiting — never the letter itself. */
export function letterWaitingEmail(personName: string, appUrl: string): { subject: string; text: string; html: string } {
  const first = personName.trim().split(/\s+/)[0] || "there";
  const link = `${appUrl.replace(/\/+$/, "")}/hub?section=documents`;
  const text = `Hi ${first},\n\nThere is a letter for you from The Calzone Kitchen in the planner app. Please sign in to read it and confirm you've read it:\n\n${link}\n\nThe Calzone Kitchen`;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const html = `<p>Hi ${esc(first)},</p><p>There is a letter for you from The Calzone Kitchen in the planner app. Please sign in to read it and confirm you've read it.</p><p><a href="${esc(link)}">Open my documents</a></p><p>The Calzone Kitchen</p>`;
  return { subject: "A letter is waiting for you in the TCK app", text, html };
}

export * from "./attention";
export * from "./reviews";
export * from "./policy-trigger";
export * from "./loose-notes";
export * from "./share-levels";
