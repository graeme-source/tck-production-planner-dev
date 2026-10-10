/**
 * Forced testing — the database half shared by routes/test-requests.ts
 * (people) and routes/test-requests-machine.ts (the deploy session). The
 * decisions themselves are pure, in test-request-rules.ts.
 */
import { z } from "zod";
import {
  db,
  andonIssuesTable,
  andonCommentsTable,
  notificationsTable,
  testRequestsTable,
  testRequestTestersTable,
  usersTable,
  type TestRequest,
} from "@workspace/db";
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { validateTestPath } from "./issue-pipeline-rules";
import { FOUNDER_EMAIL } from "./founder-email";
import {
  ANSWER_LABELS,
  answerNeedsFollowUp,
  followUpMessage,
  isHhMm,
  issueCommentFor,
  requestStatus,
  testersFor,
  validatePathPattern,
  type TestAnswer,
  type TestStatus,
} from "./test-request-rules";

// ── The create body, shared by the page and the machine API ────────────────
const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform(v => (v ? v : null));

export const createTestRequestFields = {
  title: z.string().trim().min(3, "Give it a short title").max(160),
  steps: z.string().trim().min(5, "Say what changed and what to try").max(4000),
  linkPath: optText(300).refine(v => v == null || validateTestPath(v) != null, "The page link must be an in-app path starting with /, e.g. /plans/123/station/building"),
  onlyOnPath: optText(300).refine(v => v == null || validatePathPattern(v) != null, "Only-on-page must be an in-app path; use * for any one part, e.g. /plans/*/station/building"),
  notBefore: z.string().datetime({ offset: true }).optional().nullable(),
  dailyFrom: optText(5).refine(v => v == null || isHhMm(v), "Times are HH:MM, e.g. 14:00"),
  dailyUntil: optText(5).refine(v => v == null || isHhMm(v), "Times are HH:MM, e.g. 14:00"),
  whenText: optText(200),
  andonIssueId: z.number().int().positive().optional().nullable(),
  testerIds: z.array(z.number().int().positive()).max(30).optional().default([]),
};

export type CreateTestRequestInput = {
  title: string;
  steps: string;
  linkPath: string | null;
  onlyOnPath: string | null;
  notBefore?: string | null;
  dailyFrom: string | null;
  dailyUntil: string | null;
  whenText: string | null;
  andonIssueId?: number | null;
  testerIds: number[];
};

export type CreateOutcome =
  | { ok: true; request: TestRequest; testerIds: number[] }
  | { ok: false; status: 400 | 404; error: string };

export async function createTestRequest(input: CreateTestRequestInput, by: {
  userId: number | null;
  name: string;
  source: "person" | "deploy";
  fixRef?: string | null;
}): Promise<CreateOutcome> {
  let reporterId: number | null = null;
  if (input.andonIssueId) {
    const [issue] = await db.select({ id: andonIssuesTable.id, reportedBy: andonIssuesTable.reportedBy })
      .from(andonIssuesTable).where(eq(andonIssuesTable.id, input.andonIssueId));
    if (!issue) return { ok: false, status: 404, error: `Issue #${input.andonIssueId} not found` };
    reporterId = issue.reportedBy;
  }
  // Only real, active people can be asked.
  const chosen = input.testerIds.length
    ? (await db.select({ id: usersTable.id }).from(usersTable)
        .where(and(inArray(usersTable.id, input.testerIds), eq(usersTable.isActive, true)))).map(u => u.id)
    : [];
  if (chosen.length !== new Set(input.testerIds).size) return { ok: false, status: 400, error: "One of the chosen testers isn't an active team member" };
  const picked = testersFor({ reporterId, chosenIds: chosen });
  if (!picked.ok) return { ok: false, status: 400, error: input.andonIssueId ? "The person who reported that issue no longer has an account — choose who should test it" : picked.error };

  const request = await db.transaction(async tx => {
    const [row] = await tx.insert(testRequestsTable).values({
      title: input.title,
      steps: input.steps,
      linkPath: input.linkPath,
      onlyOnPath: input.onlyOnPath,
      notBefore: input.notBefore ? new Date(input.notBefore) : null,
      dailyFrom: input.dailyFrom,
      dailyUntil: input.dailyUntil,
      whenText: input.whenText,
      andonIssueId: input.andonIssueId ?? null,
      source: by.source,
      fixRef: by.fixRef ?? null,
      createdBy: by.userId,
      createdByName: by.name,
    }).returning();
    await tx.insert(testRequestTestersTable).values(picked.testers.map(t => ({ requestId: row!.id, userId: t.userId, isReporter: t.isReporter })));
    if (row!.andonIssueId) {
      await tx.insert(andonCommentsTable).values({
        andonId: row!.andonIssueId,
        userId: by.userId,
        userName: by.name,
        comment: `Test requested: "${row!.title}" — the app will ask ${picked.testers.length === 1 ? "the tester" : `${picked.testers.length} people`} to try it and say if it works.`,
      });
    }
    return row!;
  });
  return { ok: true, request, testerIds: picked.testers.map(t => t.userId) };
}

// ── Reading: one view for the page and the machine API ──────────────────────
export type TesterView = {
  userId: number;
  name: string;
  isReporter: boolean;
  startedAt: Date | null;
  snoozeCount: number;
  answer: TestAnswer | null;
  answerLabel: string | null;
  note: string | null;
  hasPhoto: boolean;
  answeredAt: Date | null;
};

export type TestRequestView = Omit<TestRequest, "createdBy"> & {
  createdBy: number | null;
  status: TestStatus;
  issue: { id: number; description: string | null; station: string; reportedByName: string | null } | null;
  testers: TesterView[];
};

export async function loadRequestViews(where?: SQL, limit = 200): Promise<TestRequestView[]> {
  const rows = await db.select().from(testRequestsTable).where(where).orderBy(desc(testRequestsTable.createdAt)).limit(limit);
  if (rows.length === 0) return [];
  const ids = rows.map(r => r.id);
  const testers = await db.select({
    requestId: testRequestTestersTable.requestId,
    userId: testRequestTestersTable.userId,
    name: usersTable.name,
    isReporter: testRequestTestersTable.isReporter,
    startedAt: testRequestTestersTable.startedAt,
    snoozeCount: testRequestTestersTable.snoozeCount,
    answer: testRequestTestersTable.answer,
    note: testRequestTestersTable.note,
    hasPhoto: sql<boolean>`${testRequestTestersTable.photo} IS NOT NULL`,
    answeredAt: testRequestTestersTable.answeredAt,
  }).from(testRequestTestersTable)
    .innerJoin(usersTable, eq(usersTable.id, testRequestTestersTable.userId))
    .where(inArray(testRequestTestersTable.requestId, ids))
    .orderBy(desc(testRequestTestersTable.isReporter), testRequestTestersTable.id);
  const issueIds = [...new Set(rows.map(r => r.andonIssueId).filter((x): x is number => x != null))];
  const issues = issueIds.length
    ? await db.select({ id: andonIssuesTable.id, description: andonIssuesTable.description, station: andonIssuesTable.station, reportedByName: andonIssuesTable.reportedByName })
        .from(andonIssuesTable).where(inArray(andonIssuesTable.id, issueIds))
    : [];
  return rows.map(r => {
    const ts: TesterView[] = testers.filter(t => t.requestId === r.id).map(t => ({
      userId: t.userId,
      name: t.name,
      isReporter: t.isReporter,
      startedAt: t.startedAt,
      snoozeCount: t.snoozeCount,
      answer: (t.answer as TestAnswer | null) ?? null,
      answerLabel: t.answer ? ANSWER_LABELS[t.answer as TestAnswer] ?? t.answer : null,
      note: t.note,
      hasPhoto: Boolean(t.hasPhoto),
      answeredAt: t.answeredAt,
    }));
    return {
      ...r,
      status: requestStatus({ closedAt: r.closedAt, testers: ts }),
      issue: issues.find(i => i.id === r.andonIssueId) ?? null,
      testers: ts,
    };
  });
}

/** The open requests still waiting on this person. */
export async function myOpenRequests(userId: number) {
  return db.select({
    id: testRequestsTable.id,
    title: testRequestsTable.title,
    steps: testRequestsTable.steps,
    linkPath: testRequestsTable.linkPath,
    onlyOnPath: testRequestsTable.onlyOnPath,
    notBefore: testRequestsTable.notBefore,
    dailyFrom: testRequestsTable.dailyFrom,
    dailyUntil: testRequestsTable.dailyUntil,
    whenText: testRequestsTable.whenText,
    createdByName: testRequestsTable.createdByName,
    andonIssueId: testRequestsTable.andonIssueId,
    issueDescription: andonIssuesTable.description,
    isReporter: testRequestTestersTable.isReporter,
    startedAt: testRequestTestersTable.startedAt,
    snoozedUntil: testRequestTestersTable.snoozedUntil,
    createdAt: testRequestsTable.createdAt,
  }).from(testRequestTestersTable)
    .innerJoin(testRequestsTable, eq(testRequestsTable.id, testRequestTestersTable.requestId))
    .leftJoin(andonIssuesTable, eq(andonIssuesTable.id, testRequestsTable.andonIssueId))
    .where(and(eq(testRequestTestersTable.userId, userId), isNull(testRequestTestersTable.answer), isNull(testRequestsTable.closedAt)))
    .orderBy(testRequestsTable.createdAt);
}

/** After an answer: put it on the issue's thread, and tell whoever asked
 *  if it needs following up (the founder when the deploy session asked). */
export async function recordAnswerSideEffects(r: TestRequest, tester: { userId: number; name: string }, answer: TestAnswer, note: string | null): Promise<void> {
  if (r.andonIssueId) {
    await db.insert(andonCommentsTable).values({
      andonId: r.andonIssueId,
      userId: tester.userId,
      userName: tester.name,
      comment: issueCommentFor(tester.name, r.title, answer, note),
    });
  }
  if (!answerNeedsFollowUp(answer)) return;
  let notifyId = r.createdBy;
  if (notifyId == null) {
    const [founder] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, FOUNDER_EMAIL));
    notifyId = founder?.id ?? null;
  }
  if (notifyId == null || notifyId === tester.userId) return;
  await db.insert(notificationsTable).values({
    userId: notifyId,
    type: "test_request",
    message: followUpMessage(tester.name, r.title, answer),
  });
}
