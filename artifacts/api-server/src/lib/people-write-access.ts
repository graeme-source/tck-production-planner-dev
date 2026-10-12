/**
 * Who may CHANGE someone's employment record — the one rule, no I/O
 * (Graeme, 2026-10-12: "No one can write anything on it apart from me and
 * Lorna, and obviously Lorna can't write on her own. That's for me to write
 * on only.").
 *
 *   • The founder account → yes, anyone's, his own included.
 *   • Someone the founder has given People access (people_access_grants) →
 *     yes, but NEVER on their own record.
 *   • Everyone else — admins and managers included → no.
 *
 * "Their own record" is matched the way the app already links a person to an
 * account: the same app_users id, or the same email (exact match, ignoring
 * case and surrounding spaces), or the same Planday employee. Matching more
 * than the id is deliberate: a second account for the same person must not
 * become a way to edit your own file.
 *
 * A handful of writes are the employee's OWN by design (their emergency
 * contact, their new-starter form, signing their contract, their RTW form
 * draft). Those are SELF_SERVICE_KINDS: allowed for the employee on their own
 * record only, and only on the routes that name the kind. Nobody can use a
 * self-service route on someone else's record.
 *
 * Reads are NOT decided here — they stay with People access + the private
 * People PIN (people-access.ts, people-unlock.ts). Enforced on every write
 * route by middleware/employment-record-write.ts.
 */
import { isFounderEmail } from "./founder-email";

export const EMPLOYMENT_RECORD_WRITE_REFUSAL =
  "Only Graeme and Lorna can change employment records — and not their own.";

/** Shown on your own record when you can read it but not change it. */
export const OWN_RECORD_READ_ONLY_NOTE = "Only Graeme can change your own record.";

export interface RecordActor {
  id: number;
  email: string | null;
  plandayEmployeeId?: number | null;
  /** Holds a People access grant AND the account is active. */
  hasPeopleAccess: boolean;
}

export interface RecordSubject {
  id: number;
  email: string | null;
  plandayEmployeeId?: number | null;
}

function normEmail(e: string | null | undefined): string | null {
  const t = (e ?? "").trim().toLowerCase();
  return t === "" ? null : t;
}

/** Is `subject` the actor's own record? */
export function isOwnRecord(actor: Omit<RecordActor, "hasPeopleAccess">, subject: RecordSubject): boolean {
  if (actor.id === subject.id) return true;
  const a = normEmail(actor.email);
  if (a != null && a === normEmail(subject.email)) return true;
  if (actor.plandayEmployeeId != null && actor.plandayEmployeeId === subject.plandayEmployeeId) return true;
  return false;
}

/** THE rule. */
export function canWriteEmploymentRecord(actor: RecordActor, subject: RecordSubject): boolean {
  if (isFounderEmail(actor.email)) return true;
  if (!actor.hasPeopleAccess) return false;
  return !isOwnRecord(actor, subject);
}

/**
 * The employee's own writes, kept working by design. Each one is listed in
 * the audit for Graeme to confirm (he may want any of them locked too).
 */
export const SELF_SERVICE_KINDS = [
  /** Account menu → My emergency contact (PUT /api/staff-emergency-contacts/me). */
  "own_emergency_contact",
  /** The new-starter onboarding form + its uploads (/api/onboarding/me…). */
  "own_onboarding_form",
  /** Signing your own employment contract (POST /api/contracts/:id/sign). */
  "sign_own_contract",
  /** Your own HMRC/payroll/health starter forms (/api/starter-forms/mine…). */
  "own_starter_forms",
  /** Your own return-to-work form while it's a draft: open, fill, sign, attach. */
  "own_rtw_form",
] as const;
export type SelfServiceKind = (typeof SELF_SERVICE_KINDS)[number];

/**
 *  "editor" — may change the record (founder, or People access on someone else's)
 *  "self"   — it's their own record and they're not an editor of it: only
 *             the self-service writes, and only with the powers of the
 *             employee (never the manager's — e.g. no countersigning their
 *             own return-to-work form)
 *  "none"   — refused
 */
export type EmploymentRecordRight = "editor" | "self" | "none";

export function employmentRecordRight(actor: RecordActor, subject: RecordSubject): EmploymentRecordRight {
  if (canWriteEmploymentRecord(actor, subject)) return "editor";
  if (isOwnRecord(actor, subject)) return "self";
  return "none";
}

/** May this write go ahead? `selfService` names the route's self-service
 *  kind, if it has one; without it, only editors pass. */
export function mayWriteEmploymentRecord(
  actor: RecordActor,
  subject: RecordSubject,
  selfService?: SelfServiceKind,
): { ok: true; right: "editor" | "self" } | { ok: false } {
  const right = employmentRecordRight(actor, subject);
  if (right === "editor") return { ok: true, right };
  if (right === "self" && selfService != null) return { ok: true, right };
  return { ok: false };
}

/** What the record screen shows: can they change it, and if not, why. */
export function recordWriteView(actor: RecordActor, subject: RecordSubject): { canWrite: boolean; readOnlyNote: string | null } {
  if (canWriteEmploymentRecord(actor, subject)) return { canWrite: true, readOnlyNote: null };
  return { canWrite: false, readOnlyNote: isOwnRecord(actor, subject) ? OWN_RECORD_READ_ONLY_NOTE : EMPLOYMENT_RECORD_WRITE_REFUSAL };
}
