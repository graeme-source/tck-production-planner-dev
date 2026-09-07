/**
 * Self-filling onboarding matrix (Graeme, 2026-09-07): when a new starter
 * finishes their paperwork in the app, the matching training-matrix columns
 * tick themselves, so the first-day review shows what's actually done.
 *
 * Same shape as the lean-lesson auto-tick (routes/lean-reviews.ts): items
 * carry an auto_source marker (migration 0086) — no label matching in
 * logic, ever. Two sources:
 *   'starter_paperwork'   — contract signed AND all three starter forms signed
 *   'pre_arrival_details' — the pre-arrival onboarding form submitted
 */
import { db, employmentContractsTable, onboardingSubmissionsTable, starterFormSubmissionsTable, trainingMatrixItemsTable, usersTable } from "@workspace/db";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { STARTER_FORMS, STARTER_FORM_TYPES } from "./starter-forms";
import { londonDateString } from "./london-time";

async function tickItems(userId: number, autoSource: string, signedOffByName: string): Promise<void> {
  const items = await db
    .select({ id: trainingMatrixItemsTable.id, matrixId: trainingMatrixItemsTable.matrixId })
    .from(trainingMatrixItemsTable)
    .where(eq(trainingMatrixItemsTable.autoSource, autoSource));
  for (const item of items) {
    await db.execute(sql`
      INSERT INTO training_matrix_enrolments (matrix_id, user_id)
      VALUES (${item.matrixId}, ${userId})
      ON CONFLICT (matrix_id, user_id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO training_records (item_id, user_id, trained, trained_at, signed_off_by_user_id, signed_off_by_name)
      VALUES (${item.id}, ${userId}, TRUE, ${londonDateString()}, NULL, ${signedOffByName})
      ON CONFLICT (item_id, user_id)
      DO UPDATE SET trained = TRUE, trained_at = EXCLUDED.trained_at,
                    signed_off_by_name = ${signedOffByName}, updated_at = NOW()
    `);
  }
}

/** Everything signed? Contract + all three starter forms → tick. Called
 *  after every contract signature and every starter-form signature; cheap
 *  no-op until the last piece lands. */
export async function maybeTickStarterPaperwork(userId: number): Promise<void> {
  const [signedForms, signedContracts] = await Promise.all([
    db.select({ formType: starterFormSubmissionsTable.formType })
      .from(starterFormSubmissionsTable)
      .where(and(eq(starterFormSubmissionsTable.userId, userId), isNotNull(starterFormSubmissionsTable.signedAt))),
    db.select({ id: employmentContractsTable.id })
      .from(employmentContractsTable)
      .where(and(eq(employmentContractsTable.userId, userId), isNotNull(employmentContractsTable.acknowledgedAt)))
      .limit(1),
  ]);
  const signedTypes = new Set(signedForms.map(f => f.formType));
  const allFormsSigned = STARTER_FORM_TYPES.every(t => signedTypes.has(t));
  if (!allFormsSigned || signedContracts.length === 0) return;
  await tickItems(userId, "starter_paperwork", "In-app starter paperwork");
}

/** The pre-arrival onboarding form (contact + emergency details) was
 *  submitted — tick its column. */
export async function tickPreArrivalDetails(userId: number): Promise<void> {
  await tickItems(userId, "pre_arrival_details", "In-app pre-arrival form");
}

export interface StarterGateStatus {
  detailsSubmitted: boolean;
  forms: { type: string; title: string; signed: boolean }[];
  contractIssued: boolean;
  contractSigned: boolean;
  /** The contract's start date — the person's first day. */
  startDate: string | null;
  firstDayReached: boolean;
  /** All the paperwork a starter can do from home is done. */
  paperworkComplete: boolean;
  /** Kept for the client: same as paperworkComplete. The gate itself only
   *  lifts when the founder GRANTS access on the person's first day
   *  (grantAppAccess below) — never automatically (Graeme, 2026-09-07). */
  complete: boolean;
}

/** What the first-login gate still wants from this person. */
export async function starterGateStatus(userId: number): Promise<StarterGateStatus> {
  const [details, signedForms, contracts] = await Promise.all([
    db.select({
      submittedAt: onboardingSubmissionsTable.submittedAt,
      emergencyContactName: onboardingSubmissionsTable.emergencyContactName,
      emergencyContactPhone: onboardingSubmissionsTable.emergencyContactPhone,
    })
      .from(onboardingSubmissionsTable)
      .where(eq(onboardingSubmissionsTable.userId, userId)),
    db.select({ formType: starterFormSubmissionsTable.formType, signedAt: starterFormSubmissionsTable.signedAt })
      .from(starterFormSubmissionsTable)
      .where(eq(starterFormSubmissionsTable.userId, userId)),
    db.select({ id: employmentContractsTable.id, acknowledgedAt: employmentContractsTable.acknowledgedAt, startDate: employmentContractsTable.startDate })
      .from(employmentContractsTable)
      .where(eq(employmentContractsTable.userId, userId)),
  ]);
  const signedTypes = new Set(signedForms.filter(f => f.signedAt != null).map(f => f.formType));
  const forms = STARTER_FORM_TYPES.map(t => ({ type: t, title: STARTER_FORMS[t].title, signed: signedTypes.has(t) }));
  // Submitted AND the emergency contact is actually there — the write path
  // enforces it now, but rows written before it did must not read as done
  // (Graeme, 2026-09-07).
  const d = details[0];
  const detailsSubmitted = d?.submittedAt != null
    && !!d.emergencyContactName?.trim() && !!d.emergencyContactPhone?.trim();
  const contractIssued = contracts.length > 0;
  const contractSigned = contracts.some(c => c.acknowledgedAt != null);
  // The newest contract governs the first day (re-issues supersede).
  const startDate = contracts
    .map(c => String(c.startDate))
    .sort()
    .pop() ?? null;
  const firstDayReached = startDate != null && startDate <= londonDateString();
  const paperworkComplete = detailsSubmitted && forms.every(f => f.signed) && (!contractIssued || contractSigned);
  return {
    detailsSubmitted,
    forms,
    contractIssued,
    contractSigned,
    startDate,
    firstDayReached,
    paperworkComplete,
    complete: paperworkComplete,
  };
}

/** Open the rest of the app for a new starter. NEVER called automatically:
 *  finishing the paperwork shows "thanks, that's it for now", and the
 *  founder grants access when the person walks in on their first day
 *  (Graeme, 2026-09-07). Only touches accounts still inside the gate. */
export async function grantAppAccess(userId: number): Promise<boolean> {
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.onboardingRequired, true), isNull(usersTable.onboardingCompletedAt)));
  if (!user) return false;
  await db.update(usersTable)
    .set({ onboardingCompletedAt: new Date(), onboardingRequired: false, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
  return true;
}
