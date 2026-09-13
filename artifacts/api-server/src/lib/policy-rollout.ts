/**
 * Policy rollout (Graeme, 2026-09-13): when a policy goes ACTIVE — or an
 * active policy's body changes and its version bumps — everyone gets a
 * 3-day review to-do, and the "Policies" training matrix gains/keeps an
 * item for it with every active user enrolled.
 *
 * The SOURCE OF TRUTH for who has accepted what is policy_acceptances
 * (one row per policy × user × version). The matrix is a display layer:
 * ticked cells mirror current-version acceptances, and a version bump
 * unticks anyone whose acceptance is stale so the matrix always answers
 * "who has read the policy AS IT STANDS".
 */
import {
  db,
  riskAssessmentsTable,
  policyAcceptancesTable,
  usersTable,
  trainingMatricesTable,
  trainingMatrixItemsTable,
  trainingMatrixEnrolmentsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

export const POLICIES_MATRIX_NAME = "Policies";
const REVIEW_DAYS = 3;

/** Find-or-create the Policies matrix and this policy's item on it. */
export async function ensurePoliciesMatrixItem(policyId: number, title: string): Promise<{ matrixId: number; itemId: number }> {
  let [matrix] = await db
    .select({ id: trainingMatricesTable.id })
    .from(trainingMatricesTable)
    .where(eq(trainingMatricesTable.name, POLICIES_MATRIX_NAME));
  if (!matrix) {
    [matrix] = await db
      .insert(trainingMatricesTable)
      .values({
        name: POLICIES_MATRIX_NAME,
        description: "Company policies — ticks itself when someone confirms they've read a policy; unticks when a policy is updated until they re-confirm.",
      })
      .returning({ id: trainingMatricesTable.id });
  }
  let [item] = await db
    .select({ id: trainingMatrixItemsTable.id })
    .from(trainingMatrixItemsTable)
    .where(and(eq(trainingMatrixItemsTable.matrixId, matrix.id), eq(trainingMatrixItemsTable.sopId, policyId)));
  if (!item) {
    const [{ maxSort }] = await db
      .select({ maxSort: sql<number>`COALESCE(MAX(${trainingMatrixItemsTable.sortOrder}), -1)` })
      .from(trainingMatrixItemsTable)
      .where(eq(trainingMatrixItemsTable.matrixId, matrix.id));
    [item] = await db
      .insert(trainingMatrixItemsTable)
      .values({ matrixId: matrix.id, label: title, sopId: policyId, sortOrder: Number(maxSort) + 1 })
      .returning({ id: trainingMatrixItemsTable.id });
  }
  return { matrixId: matrix.id, itemId: item.id };
}

/** Enrol one user in a matrix (no-op when already enrolled). */
export async function enrolUser(matrixId: number, userId: number) {
  await db.insert(trainingMatrixEnrolmentsTable)
    .values({ matrixId, userId })
    .onConflictDoNothing();
}

/**
 * Roll a policy out to the whole team. Idempotent — safe to run at boot,
 * on activation and on every version bump:
 *  - ensures the Policies matrix item + enrolments for all active users;
 *  - unticks matrix cells for anyone without a CURRENT-version acceptance
 *    (a fresh policy: everyone; an update: everyone who accepted an older
 *    version), noting why;
 *  - creates a "Review & accept" to-do due in 3 days for each active user
 *    still lacking a current acceptance and an open to-do for it.
 */
export async function rolloutPolicy(policyId: number): Promise<{ todosCreated: number } | null> {
  const [policy] = await db
    .select({
      id: riskAssessmentsTable.id,
      title: riskAssessmentsTable.title,
      type: riskAssessmentsTable.assessmentType,
      status: riskAssessmentsTable.status,
      version: riskAssessmentsTable.policyVersion,
    })
    .from(riskAssessmentsTable)
    .where(eq(riskAssessmentsTable.id, policyId));
  if (!policy || policy.type !== "policy" || policy.status !== "active") return null;

  const { matrixId, itemId } = await ensurePoliciesMatrixItem(policy.id, policy.title);

  // Everyone active joins the Policies matrix.
  await db.execute(sql`
    INSERT INTO training_matrix_enrolments (matrix_id, user_id)
    SELECT ${matrixId}, u.id FROM app_users u WHERE u.is_active = TRUE
    ON CONFLICT DO NOTHING
  `);

  // Stale ticks come off: anyone trained on this item without a
  // current-version acceptance is awaiting (re-)review.
  await db.execute(sql`
    UPDATE training_records r
       SET trained = FALSE,
           signed_off_by_name = 'Policy updated — awaiting re-review',
           updated_at = NOW()
     WHERE r.item_id = ${itemId}
       AND r.trained = TRUE
       AND NOT EXISTS (
         SELECT 1 FROM policy_acceptances a
          WHERE a.policy_id = ${policy.id} AND a.user_id = r.user_id AND a.version = ${policy.version}
       )
  `);

  // A 3-day review to-do for every active user lacking a current
  // acceptance and lacking an open to-do for this policy already.
  const url = `/documents/${policy.id}`;
  const result = await db.execute<{ id: number }>(sql`
    INSERT INTO todo_tasks (assignee_id, created_by, created_by_name, title, notes, url, priority, due_date, status)
    SELECT u.id, NULL, 'Policy review',
           ${`Review & accept: ${policy.title}`},
           ${"Read the policy and tap ‘I’ve read and understood’ at the bottom — that records your acceptance. Please do this within 3 days."},
           ${url}, 'high', CURRENT_DATE + ${REVIEW_DAYS}::integer, 'open'
      FROM app_users u
     WHERE u.is_active = TRUE
       AND NOT EXISTS (
         SELECT 1 FROM policy_acceptances a
          WHERE a.policy_id = ${policy.id} AND a.user_id = u.id AND a.version = ${policy.version}
       )
       AND NOT EXISTS (
         SELECT 1 FROM todo_tasks t
          WHERE t.assignee_id = u.id AND t.url = ${url} AND t.status <> 'done'
       )
    RETURNING id
  `);
  const todosCreated = (result.rows ?? []).length;
  console.log(`[policy-rollout] ${policy.title} v${policy.version}: ${todosCreated} review to-dos created`);
  return { todosCreated };
}

/**
 * Record one user's acceptance of a policy at its current version:
 * acceptance row (the source of truth), matrix enrolment + tick, and the
 * review to-do closes. Returns the accepted version, or null when the
 * document isn't an active policy.
 */
export async function recordPolicyAcceptance(policyId: number, userId: number, userName: string): Promise<number | null> {
  const [policy] = await db
    .select({
      id: riskAssessmentsTable.id,
      title: riskAssessmentsTable.title,
      type: riskAssessmentsTable.assessmentType,
      status: riskAssessmentsTable.status,
      version: riskAssessmentsTable.policyVersion,
    })
    .from(riskAssessmentsTable)
    .where(eq(riskAssessmentsTable.id, policyId));
  if (!policy || policy.type !== "policy" || policy.status !== "active") return null;

  await db.insert(policyAcceptancesTable)
    .values({ policyId: policy.id, userId, version: policy.version })
    .onConflictDoNothing();

  // Matrix display: enrol (covers pre-arrival starters created after the
  // rollout) — the caller's tick loop then finds the item enrolled.
  const { matrixId } = await ensurePoliciesMatrixItem(policy.id, policy.title);
  await enrolUser(matrixId, userId);

  // The review to-do closes itself.
  await db.execute(sql`
    UPDATE todo_tasks SET status = 'done', completed_at = NOW(), updated_at = NOW()
     WHERE assignee_id = ${userId} AND url = ${`/documents/${policy.id}`} AND status <> 'done'
  `);
  void userName;
  return policy.version;
}

/** The caller's acceptance state for one policy document. */
export async function acceptanceState(policyId: number, userId: number): Promise<{ version: number; acceptedVersion: number | null; needsAcceptance: boolean } | null> {
  const [policy] = await db
    .select({
      type: riskAssessmentsTable.assessmentType,
      status: riskAssessmentsTable.status,
      version: riskAssessmentsTable.policyVersion,
    })
    .from(riskAssessmentsTable)
    .where(eq(riskAssessmentsTable.id, policyId));
  if (!policy || policy.type !== "policy") return null;
  const rows = await db
    .select({ version: policyAcceptancesTable.version })
    .from(policyAcceptancesTable)
    .where(and(eq(policyAcceptancesTable.policyId, policyId), eq(policyAcceptancesTable.userId, userId)));
  const acceptedVersion = rows.length ? Math.max(...rows.map(r => r.version)) : null;
  return {
    version: policy.version,
    acceptedVersion,
    needsAcceptance: policy.status === "active" && (acceptedVersion == null || acceptedVersion < policy.version),
  };
}
