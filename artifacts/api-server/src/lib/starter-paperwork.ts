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
  /** Everything a first login must finish before the app opens: details +
   *  all three forms signed + the contract signed IF one has been issued.
   *  A missing contract never locks somebody out — issuing it is the
   *  founder's move, not theirs; it waits in their hub instead. */
  complete: boolean;
}

/** What the first-login gate still wants from this person. */
export async function starterGateStatus(userId: number): Promise<StarterGateStatus> {
  const [details, signedForms, contracts] = await Promise.all([
    db.select({ submittedAt: onboardingSubmissionsTable.submittedAt })
      .from(onboardingSubmissionsTable)
      .where(eq(onboardingSubmissionsTable.userId, userId)),
    db.select({ formType: starterFormSubmissionsTable.formType, signedAt: starterFormSubmissionsTable.signedAt })
      .from(starterFormSubmissionsTable)
      .where(eq(starterFormSubmissionsTable.userId, userId)),
    db.select({ id: employmentContractsTable.id, acknowledgedAt: employmentContractsTable.acknowledgedAt })
      .from(employmentContractsTable)
      .where(eq(employmentContractsTable.userId, userId)),
  ]);
  const signedTypes = new Set(signedForms.filter(f => f.signedAt != null).map(f => f.formType));
  const forms = STARTER_FORM_TYPES.map(t => ({ type: t, title: STARTER_FORMS[t].title, signed: signedTypes.has(t) }));
  const detailsSubmitted = details[0]?.submittedAt != null;
  const contractIssued = contracts.length > 0;
  const contractSigned = contracts.some(c => c.acknowledgedAt != null);
  return {
    detailsSubmitted,
    forms,
    contractIssued,
    contractSigned,
    complete: detailsSubmitted && forms.every(f => f.signed) && (!contractIssued || contractSigned),
  };
}

/** Lift the first-login gate the moment the last piece lands. Only ever
 *  touches users still inside the gate — nobody already onboarded is
 *  re-flagged or re-stamped. */
export async function maybeCompleteOnboarding(userId: number): Promise<void> {
  const [user] = await db
    .select({ required: usersTable.onboardingRequired })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.onboardingRequired, true), isNull(usersTable.onboardingCompletedAt)));
  if (!user) return;
  const gate = await starterGateStatus(userId);
  if (!gate.complete) return;
  await db.update(usersTable)
    .set({ onboardingCompletedAt: new Date(), onboardingRequired: false, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
}
