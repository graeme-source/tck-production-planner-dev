/**
 * Forced testing — the database half shared by routes/test-requests.ts
 * (people) and routes/test-requests-machine.ts. The decisions themselves are
 * pure, in test-request-rules.ts.
 */
import { z } from "zod";
import {
  db,
  andonIssuesTable,
  andonCommentsTable,
  improvementCommentsTable,
  improvementSubmissionsTable,
  notificationsTable,
  testRequestsTable,
  testRequestTestersTable,
  usersTable,
  type TestRequest,
  type TestRequestTester,
} from "@workspace/db";
import { and, desc, eq, inArray, isNull, isNotNull, sql, type SQL } from "drizzle-orm";
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
  testTodoTitle,
  testTodoUrl,
  todoPlan,
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
  improvementId: z.number().int().positive().optional().nullable(),
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
  improvementId?: number | null;
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
  let submitterId: number | null = null;
  if (input.improvementId) {
    const [imp] = await db.select({ id: improvementSubmissionsTable.id, submittedBy: improvementSubmissionsTable.submittedBy })
      .from(improvementSubmissionsTable).where(eq(improvementSubmissionsTable.id, input.improvementId));
    if (!imp) return { ok: false, status: 404, error: `Improvement #${input.improvementId} not found` };
    submitterId = imp.submittedBy;
  }
  // Only real, active people can be asked — the origin people included.
  const wanted = [...new Set([...input.testerIds, reporterId, submitterId].filter((x): x is number => x != null))];
  const active = wanted.length
    ? new Set((await db.select({ id: usersTable.id }).from(usersTable)
        .where(and(inArray(usersTable.id, wanted), eq(usersTable.isActive, true)))).map(u => u.id))
    : new Set<number>();
  if (input.testerIds.some(id => !active.has(id))) return { ok: false, status: 400, error: "One of the chosen testers isn't an active team member" };
  const picked = testersFor({
    originIds: [reporterId, submitterId].map(id => (id != null && active.has(id) ? id : null)),
    chosenIds: input.testerIds,
  });
  if (!picked.ok) {
    const origin = input.andonIssueId ? "reported that issue" : input.improvementId ? "logged that improvement" : null;
    return { ok: false, status: 400, error: origin ? `The person who ${origin} isn't an active team member any more — choose who should test it` : picked.error };
  }

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
      improvementId: input.improvementId ?? null,
      source: by.source,
      fixRef: by.fixRef ?? null,
      createdBy: by.userId,
      createdByName: by.name,
    }).returning();
    await tx.insert(testRequestTestersTable).values(picked.testers.map(t => ({ requestId: row!.id, userId: t.userId, isReporter: t.isReporter })));
    const note = `Test requested: "${row!.title}" — the app will ask ${picked.testers.length === 1 ? "the tester" : `${picked.testers.length} people`} to try it and say if it works.`;
    if (row!.andonIssueId) {
      await tx.insert(andonCommentsTable).values({ andonId: row!.andonIssueId, userId: by.userId, userName: by.name, comment: note });
    }
    if (row!.improvementId) {
      await tx.insert(improvementCommentsTable).values({ improvementId: row!.improvementId, userId: by.userId, userName: by.name, comment: note });
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
  promptedAt: Date | null;
  onTodoList: boolean;
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
  improvement: { id: number; title: string; submittedByName: string | null } | null;
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
    promptedAt: testRequestTestersTable.promptedAt,
    todoTaskId: testRequestTestersTable.todoTaskId,
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
  const impIds = [...new Set(rows.map(r => r.improvementId).filter((x): x is number => x != null))];
  const imps = impIds.length
    ? await db.select({ id: improvementSubmissionsTable.id, title: improvementSubmissionsTable.title, submittedByName: improvementSubmissionsTable.submittedByName })
        .from(improvementSubmissionsTable).where(inArray(improvementSubmissionsTable.id, impIds))
    : [];
  return rows.map(r => {
    const ts: TesterView[] = testers.filter(t => t.requestId === r.id).map(t => ({
      userId: t.userId,
      name: t.name,
      isReporter: t.isReporter,
      startedAt: t.startedAt,
      promptedAt: t.promptedAt,
      onTodoList: t.todoTaskId != null,
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
      improvement: imps.find(i => i.id === r.improvementId) ?? null,
      testers: ts,
    };
  });
}

/** The open requests still waiting on this person (the card decides which,
 *  if any, to show — production-planner lib/test-requests.ts). */
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
    improvementId: testRequestsTable.improvementId,
    improvementTitle: improvementSubmissionsTable.title,
    isReporter: testRequestTestersTable.isReporter,
    startedAt: testRequestTestersTable.startedAt,
    promptedAt: testRequestTestersTable.promptedAt,
    todoTaskId: testRequestTestersTable.todoTaskId,
    createdAt: testRequestsTable.createdAt,
  }).from(testRequestTestersTable)
    .innerJoin(testRequestsTable, eq(testRequestsTable.id, testRequestTestersTable.requestId))
    .leftJoin(andonIssuesTable, eq(andonIssuesTable.id, testRequestsTable.andonIssueId))
    .leftJoin(improvementSubmissionsTable, eq(improvementSubmissionsTable.id, testRequestsTable.improvementId))
    .where(and(eq(testRequestTestersTable.userId, userId), isNull(testRequestTestersTable.answer), isNull(testRequestsTable.closedAt)))
    .orderBy(testRequestsTable.createdAt);
}

// ── The tester's to-do ("I'll do it later") ─────────────────────────────────

/**
 * Put the test on the tester's OWN to-do list, once. Added already
 * acknowledged and created by themselves, so it never raises the full-screen
 * "you've been asked to…" takeover or a bell. Its link reopens the card.
 */
export async function putTestOnTodoList(r: TestRequest, t: TestRequestTester, testerName: string): Promise<number> {
  if (t.todoTaskId) return t.todoTaskId;
  return db.transaction(async tx => {
    const where = r.whenText || (r.onlyOnPath ? `On ${r.onlyOnPath}` : null);
    const notes = `${r.steps}${where ? `\n\nWhen: ${where}` : ""}\n\nAsked by ${r.createdByName}. Open the link to test it and answer.`;
    const rows = await tx.execute<{ id: number }>(sql`
      INSERT INTO todo_tasks (assignee_id, created_by, created_by_name, title, notes, url, priority, acknowledged_at)
      VALUES (${t.userId}, ${t.userId}, ${testerName}, ${testTodoTitle(r.title)}, ${notes.slice(0, 5000)}, ${testTodoUrl(r.id)}, 'normal', NOW())
      RETURNING id
    `);
    const id = Number(rows.rows[0]!.id);
    await tx.execute(sql`
      INSERT INTO todo_task_comments (task_id, user_id, user_name, kind, body)
      VALUES (${id}, ${t.userId}, ${testerName}, 'event', ${"Added from a test request — answering the test ticks this off"})
    `);
    await tx.update(testRequestTestersTable).set({ todoTaskId: id, promptedAt: t.promptedAt ?? new Date() }).where(eq(testRequestTestersTable.id, t.id));
    return id;
  });
}

async function applyTodoPlan(event: "answered" | "closed", todoIds: number[], actorName: string): Promise<void> {
  if (!todoIds.length) return;
  const todos = await db.execute<{ id: number; status: string }>(sql`
    SELECT id, status FROM todo_tasks WHERE id IN (${sql.join(todoIds.map(i => sql`${i}`), sql`, `)})
  `);
  for (const todo of todos.rows) {
    const plan = todoPlan(event, todo);
    if (plan === "tick") {
      await db.execute(sql`UPDATE todo_tasks SET status = 'done', completed_at = NOW(), updated_at = NOW() WHERE id = ${todo.id}`);
      await db.execute(sql`
        INSERT INTO todo_task_comments (task_id, user_id, user_name, kind, body)
        VALUES (${todo.id}, ${null}, ${actorName}, 'event', ${"Ticked off — the test has been answered"})
      `);
    } else if (plan === "delete") {
      // todo_tasks has no soft delete (same as test-box to-dos): the
      // request itself keeps the record.
      await db.execute(sql`DELETE FROM todo_tasks WHERE id = ${todo.id}`);
    }
  }
}

/** A manager closed the request: take the still-open to-dos off people's lists. */
export async function removeOpenTodosFor(requestId: number): Promise<void> {
  const rows = await db.select({ todoTaskId: testRequestTestersTable.todoTaskId }).from(testRequestTestersTable)
    .where(and(eq(testRequestTestersTable.requestId, requestId), isNotNull(testRequestTestersTable.todoTaskId)));
  await applyTodoPlan("closed", rows.map(r => r.todoTaskId!), "Test request");
}

/** After an answer: tick the to-do, put it on the issue's / improvement's
 *  thread, and tell whoever asked if it needs following up (the founder
 *  when the machine API asked). */
export async function recordAnswerSideEffects(r: TestRequest, tester: { userId: number; name: string; todoTaskId: number | null }, answer: TestAnswer, note: string | null): Promise<void> {
  if (tester.todoTaskId) await applyTodoPlan("answered", [tester.todoTaskId], tester.name);
  const comment = issueCommentFor(tester.name, r.title, answer, note);
  if (r.andonIssueId) {
    await db.insert(andonCommentsTable).values({ andonId: r.andonIssueId, userId: tester.userId, userName: tester.name, comment });
  }
  if (r.improvementId) {
    await db.insert(improvementCommentsTable).values({ improvementId: r.improvementId, userId: tester.userId, userName: tester.name, comment });
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
