/**
 * The issue pipeline's database half (docs/ISSUE_PIPELINE.md). Shared by the
 * token-authed machine routes (the scheduled Claude Code session) and the
 * session-authed Fix queue / reporter-notice routes, so both see issues in
 * exactly the same shape. The decisions live in issue-pipeline-rules.ts.
 */
import {
  db,
  andonIssuesTable,
  andonCommentsTable,
  notificationsTable,
  issueTriageTable,
  issueTriageEventsTable,
  issueFixNoticesTable,
  improvementSubmissionsTable,
  type IssueTriage,
} from "@workspace/db";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  classifyIssueArea, improvementDoneAt, isImprovementDue, isRepeatOfEarlierRequest, noticeQuote, reporterConversation, reporterResponsePlan,
  type IssueAreaClass, type NoticeAckAction, type TriageStatus,
} from "./issue-pipeline-rules";
import { pinLeadCredit } from "./improvement-credits-data";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Db = typeof db | Tx;

const CATEGORY_LABELS: Record<string, string> = {
  equipment: "Equipment", safety: "Safety", production: "Production", product: "Product", other: "Other",
};

export interface IssueComment { id: number; author: string | null; text: string; createdAt: Date }
export interface IssueAttachment { id: number; kind: string; mime: string; fileName: string | null; createdAt: string; url: string }
export interface IssueView {
  id: number;
  createdAt: Date;
  area: string | null;
  areaClass: IssueAreaClass;
  category: string;
  severity: string;
  station: string;
  description: string | null;
  reportContext: string | null;
  reporter: { id: number | null; name: string | null };
  acknowledged: { at: Date; byName: string | null } | null;
  resolved: { at: Date; byName: string | null } | null;
  improvementId: number | null;
  comments: IssueComment[];
  attachments: IssueAttachment[];
}

type AndonRow = typeof andonIssuesTable.$inferSelect;

/** Raw-SQL timestamps come back as "2026-09-18 10:00:47.95634" (no zone).
 *  Read them as UTC, exactly as Drizzle's own timestamp columns do, so every
 *  time in a response is the same ISO shape. */
function utcIso(raw: string | Date): string {
  if (raw instanceof Date) return raw.toISOString();
  const d = new Date(/[zZ]$|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? raw : d.toISOString();
}

/** Comments + attachment metadata for a set of issues, in the shared shape.
 *  `attachmentUrl` differs per audience: the machine API serves bytes behind
 *  its token; the Fix queue reuses the andon log's session-authed file URL. */
export async function buildIssueViews(
  rows: AndonRow[],
  attachmentUrl: (attachmentId: number) => string,
): Promise<IssueView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map(r => r.id);
  const comments = await db.select().from(andonCommentsTable)
    .where(inArray(andonCommentsTable.andonId, ids))
    .orderBy(asc(andonCommentsTable.createdAt));
  const atts = await db.execute<{ id: number; issue_id: number; kind: string; mime: string; file_name: string | null; created_at: string }>(sql`
    SELECT id, issue_id, kind, mime, file_name, created_at FROM andon_attachments
    WHERE issue_id IN (${sql.join(ids.map(i => sql`${i}`), sql`, `)})
    ORDER BY id
  `);
  return rows.map(r => ({
    id: r.id,
    createdAt: r.createdAt,
    area: r.area,
    areaClass: classifyIssueArea(r.area, r.station),
    category: r.category,
    severity: r.severity,
    station: r.station,
    description: r.description,
    reportContext: r.reportContext,
    reporter: { id: r.reportedBy, name: r.reportedByName },
    acknowledged: r.acknowledgedAt ? { at: r.acknowledgedAt, byName: r.acknowledgedByName } : null,
    resolved: r.resolvedAt ? { at: r.resolvedAt, byName: r.resolvedByName } : null,
    improvementId: r.improvementId,
    comments: comments.filter(c => c.andonId === r.id).map(c => ({ id: c.id, author: c.userName, text: c.comment, createdAt: c.createdAt })),
    attachments: atts.rows.filter(a => a.issue_id === r.id).map(a => ({
      id: a.id, kind: a.kind, mime: a.mime, fileName: a.file_name, createdAt: utcIso(a.created_at), url: attachmentUrl(a.id),
    })),
  }));
}

export async function loadAndonRows(ids: number[]): Promise<AndonRow[]> {
  if (ids.length === 0) return [];
  return db.select().from(andonIssuesTable).where(inArray(andonIssuesTable.id, ids));
}

export async function triageByIssueId(issueIds: number[]): Promise<Map<number, IssueTriage>> {
  const map = new Map<number, IssueTriage>();
  if (issueIds.length === 0) return map;
  const rows = await db.select().from(issueTriageTable).where(inArray(issueTriageTable.andonIssueId, issueIds));
  for (const r of rows) map.set(r.andonIssueId, r);
  return map;
}

/** Append to the history with the row as it now stands. */
export async function recordEvent(
  conn: Db,
  triage: IssueTriage,
  event: string,
  actor: string | null,
  note: string | null = null,
): Promise<void> {
  await conn.insert(issueTriageEventsTable).values({
    triageId: triage.id,
    andonIssueId: triage.andonIssueId,
    event,
    actor,
    note,
    snapshot: triage as unknown as Record<string, unknown>,
  });
}

/**
 * The reporter answered (Graeme, 2026-10-13) — from their pop-up (a typed
 * reply, or "Got it" / "I'll test it later") or a comment on the issue log.
 * Writes the history line the card's Conversation shows and, when the rule
 * says so (reporterResponsePlan), flags the card "New reply from <name>" so
 * it sits in To review until Graeme acts on it. Nothing goes to Claude: the
 * awaiting-retriage flag is untouched. The caller stores any comment text on
 * the andon issue itself.
 */
export async function recordReporterResponse(
  conn: Db,
  triage: IssueTriage,
  reporterName: string | null,
  response: { kind: string; action: NoticeAckAction | "comment"; reply?: string | null },
): Promise<{ triage: IssueTriage; flagged: boolean }> {
  const plan = reporterResponsePlan(triage, response);
  // Only an answer in words ends the wait — "Got it" is a read receipt
  // (21 Oct 2026), so the card still says Graeme is waiting for a reply.
  const answers = plan.answers;
  let row = triage;
  if (plan.flagForGraeme || (answers && triage.awaitingReporterSince)) {
    const now = new Date();
    [row] = await conn.update(issueTriageTable).set({
      ...(plan.flagForGraeme ? { reporterReplyAt: now } : {}),
      ...(answers ? { awaitingReporterSince: null } : {}),
      updatedAt: now,
    }).where(eq(issueTriageTable.id, triage.id)).returning() as [IssueTriage];
  }
  await recordEvent(conn, row, plan.event, reporterName, plan.note);
  return { triage: row, flagged: plan.flagForGraeme };
}

/**
 * A comment on the issue log by the person who reported it, on a report
 * that has a Fix queue card — it reaches the card like a reply from their
 * pop-up. Anyone else's comment (a manager's, Graeme's own) changes nothing.
 */
export async function onAndonComment(issueId: number, userId: number, comment: string): Promise<void> {
  const [issue] = await db.select({ reportedBy: andonIssuesTable.reportedBy, reportedByName: andonIssuesTable.reportedByName })
    .from(andonIssuesTable).where(eq(andonIssuesTable.id, issueId));
  if (!issue || issue.reportedBy == null || issue.reportedBy !== userId) return;
  const [triage] = await db.select().from(issueTriageTable).where(eq(issueTriageTable.andonIssueId, issueId));
  if (!triage) return;
  await recordReporterResponse(db, triage, issue.reportedByName, { kind: "comment", action: "comment", reply: comment });
}

export interface ResolveOutcome {
  issueId: number;
  resolvedNow: boolean;
  noticeQueued: boolean;
  reporterId: number | null;
}

/**
 * Close one andon issue after its fix is live, the way the andon log closes
 * one (resolved_by / resolved_by_name / resolved_at + a notification to the
 * reporter), plus:
 *  - a comment on the issue itself, so anyone reading the log sees what
 *    changed ("Your report changed this — here's what's different: …");
 *  - the reporter's full-screen "fixed — please test" notice.
 * An issue a manager already resolved is not re-stamped, but its reporter is
 * still told what changed. The one-pending-notice index makes a retry safe.
 */
export async function resolveIssueWithNotice(
  tx: Tx,
  issue: AndonRow,
  opts: { triageId: number; resolverUserId: number | null; resolverName: string; whatChanged: string; testPath: string | null },
): Promise<ResolveOutcome> {
  let resolvedNow = false;
  if (!issue.resolvedAt) {
    await tx.update(andonIssuesTable)
      .set({ resolvedBy: opts.resolverUserId, resolvedByName: opts.resolverName, resolvedAt: new Date() })
      .where(eq(andonIssuesTable.id, issue.id));
    resolvedNow = true;
  }

  const commentText = [
    `Your report changed this — here's what's different: ${opts.whatChanged}`,
    opts.testPath ? `Try it here: ${opts.testPath}` : null,
  ].filter(Boolean).join("\n\n");
  await tx.insert(andonCommentsTable).values({ andonId: issue.id, userId: null, userName: "Fix queue", comment: commentText });

  let noticeQueued = false;
  if (issue.reportedBy) {
    const label = CATEGORY_LABELS[issue.category] ?? issue.category;
    await tx.insert(notificationsTable).values({
      userId: issue.reportedBy,
      type: "resolved",
      message: `Your report was fixed: ${label} - ${issue.station}. Please test it.`,
      andonIssueId: issue.id,
    });
    const inserted = await tx.insert(issueFixNoticesTable).values({
      andonIssueId: issue.id,
      triageId: opts.triageId,
      userId: issue.reportedBy,
      quote: noticeQuote(issue.description, `${label} issue at ${issue.station}`),
      whatChanged: opts.whatChanged,
      testPath: opts.testPath,
    }).onConflictDoNothing().returning({ id: issueFixNoticesTable.id });
    noticeQueued = inserted.length > 0;
  }

  return { issueId: issue.id, resolvedNow, noticeQueued, reporterId: issue.reportedBy };
}

/**
 * Graeme's "Message the reporter" (2026-09-24): his own words to the person
 * who reported it — often "no fix needed, here's how to do it yourself" —
 * as a comment on the issue, a bell notification and a full-screen "A reply
 * to your report" notice. With `close`, the issue is resolved too (the same
 * stamp the andon log uses). If an earlier notice for this issue is still
 * unread, the new message replaces it, so they only ever see the latest.
 */
export async function messageReporter(
  tx: Tx,
  issue: AndonRow,
  opts: { triageId: number; senderUserId: number; senderName: string; message: string; close: boolean },
): Promise<{ resolvedNow: boolean; noticeQueued: boolean }> {
  let resolvedNow = false;
  if (opts.close && !issue.resolvedAt) {
    await tx.update(andonIssuesTable)
      .set({ resolvedBy: opts.senderUserId, resolvedByName: opts.senderName, resolvedAt: new Date() })
      .where(eq(andonIssuesTable.id, issue.id));
    resolvedNow = true;
  }
  await tx.insert(andonCommentsTable).values({ andonId: issue.id, userId: opts.senderUserId, userName: opts.senderName, comment: opts.message });

  if (!issue.reportedBy) return { resolvedNow, noticeQueued: false };
  const label = CATEGORY_LABELS[issue.category] ?? issue.category;
  await tx.insert(notificationsTable).values({
    userId: issue.reportedBy,
    type: opts.close ? "resolved" : "comment",
    message: `${opts.senderName} replied to your report: ${label} - ${issue.station}`,
    andonIssueId: issue.id,
  });
  const values = {
    andonIssueId: issue.id,
    triageId: opts.triageId,
    userId: issue.reportedBy,
    kind: "message",
    quote: noticeQuote(issue.description, `${label} issue at ${issue.station}`),
    whatChanged: opts.message,
    testPath: null,
  };
  const inserted = await tx.insert(issueFixNoticesTable).values(values).onConflictDoNothing().returning({ id: issueFixNoticesTable.id });
  if (inserted.length === 0) {
    await tx.update(issueFixNoticesTable)
      .set({ kind: "message", whatChanged: opts.message, testPath: null, createdAt: new Date() })
      .where(and(eq(issueFixNoticesTable.andonIssueId, issue.id), isNull(issueFixNoticesTable.acknowledgedAt)));
  }
  return { resolvedNow, noticeQueued: true };
}

/**
 * Credit a completed improvement to the person who reported it (Graeme,
 * 2026-09-24). Called whenever a report closes — fixed and resolved,
 * answered, or dismissed as already done — and a no-op unless the report
 * was an improvement to the system (lane 'improvement') not yet credited.
 *
 * If the report already raised an improvement (andon_issues.improvement_id),
 * that one is completed and credited; otherwise a new completed improvement
 * is created in the reporter's name, dated the day it actually went live
 * (completed_on) so old reports don't inflate today's KPI.
 */
export async function creditImprovementIfDue(tx: Tx, triage: IssueTriage, approverName: string): Promise<number | null> {
  if (!isImprovementDue({ ...triage, status: triage.status as TriageStatus })) return null;
  // One build, one credit: a repeat of an earlier approved/built request isn't credited.
  const relatedIds = (triage.relatedIssueIds ?? []).filter(id => id < triage.andonIssueId);
  if (relatedIds.length) {
    const related = await tx.select({ andonIssueId: issueTriageTable.andonIssueId, lane: issueTriageTable.lane, status: issueTriageTable.status })
      .from(issueTriageTable).where(inArray(issueTriageTable.andonIssueId, relatedIds));
    if (isRepeatOfEarlierRequest(triage.andonIssueId, related)) return null;
  }
  const [issue] = await tx.select().from(andonIssuesTable).where(eq(andonIssuesTable.id, triage.andonIssueId));
  if (!issue) return null;
  const now = new Date();
  const doneAt = improvementDoneAt(triage.completedOn, now);
  const approval = { approvedBy: triage.decidedByUserId, approvedByName: approverName, approvedAt: now };

  let improvementId: number | null = null;
  if (issue.improvementId) {
    // The reporter becomes the lead name, and anyone ALREADY credited on
    // the improvement keeps their credit (migration 0125) — pin the current
    // lead as a row before it's replaced. With no known reporter the
    // existing credit is left as it is rather than wiped.
    await pinLeadCredit(tx, issue.improvementId);
    const [row] = await tx.update(improvementSubmissionsTable).set({
      progressStatus: "complete",
      ...(issue.reportedBy != null ? { creditedTo: issue.reportedBy, creditedToName: issue.reportedByName } : {}),
      doneAt: sql`COALESCE(${improvementSubmissionsTable.doneAt}, ${doneAt})`,
      ...approval,
      updatedAt: now,
    }).where(eq(improvementSubmissionsTable.id, issue.improvementId)).returning({ id: improvementSubmissionsTable.id });
    improvementId = row?.id ?? null;
  }
  if (improvementId == null) {
    const words = (issue.description ?? "").trim() || `Improvement from issue #${issue.id}`;
    const title = words.length > 120 ? `${words.slice(0, 117).trimEnd()}…` : words;
    const [row] = await tx.insert(improvementSubmissionsTable).values({
      title,
      description: `${words}\n\nReported as issue #${issue.id} and completed through the Fix queue.`,
      station: issue.station,
      type: "improvement",
      submittedBy: issue.reportedBy,
      submittedByName: issue.reportedByName,
      creditedTo: issue.reportedBy,
      creditedToName: issue.reportedByName,
      progressStatus: "complete",
      doneAt,
      ...approval,
      // Linked back through andon_issues.improvement_id and
      // issue_triage.improvement_id (subject_id belongs to lean subjects).
      createdAt: issue.createdAt,
      updatedAt: now,
    }).returning({ id: improvementSubmissionsTable.id });
    improvementId = row.id;
    await tx.update(andonIssuesTable).set({ improvementId }).where(eq(andonIssuesTable.id, issue.id));
  }
  // The reporter's own credit row — they count on the scoreboard alongside
  // everyone else credited on it.
  await pinLeadCredit(tx, improvementId);
  await tx.update(issueTriageTable).set({ improvementId, updatedAt: now }).where(eq(issueTriageTable.id, triage.id));
  await recordEvent(tx, { ...triage, improvementId }, "improvement_credited", approverName,
    `Improvement #${improvementId} credited to ${issue.reportedByName ?? "the reporter"}`);
  return improvementId;
}

/** Latest notices per triage row, for the Fix queue's "reporter notified" line. */
export async function noticesByTriageId(triageIds: number[]) {
  const map = new Map<number, Array<{ id: number; andonIssueId: number; userId: number; kind: string; ackAction: string | null; acknowledgedAt: Date | null; createdAt: Date }>>();
  if (triageIds.length === 0) return map;
  const rows = await db.select({
    id: issueFixNoticesTable.id,
    triageId: issueFixNoticesTable.triageId,
    andonIssueId: issueFixNoticesTable.andonIssueId,
    userId: issueFixNoticesTable.userId,
    kind: issueFixNoticesTable.kind,
    ackAction: issueFixNoticesTable.ackAction,
    acknowledgedAt: issueFixNoticesTable.acknowledgedAt,
    createdAt: issueFixNoticesTable.createdAt,
  }).from(issueFixNoticesTable)
    .where(inArray(issueFixNoticesTable.triageId, triageIds))
    .orderBy(asc(issueFixNoticesTable.createdAt));
  for (const { triageId, ...rest } of rows) {
    if (triageId == null) continue;
    const list = map.get(triageId) ?? [];
    list.push(rest);
    map.set(triageId, list);
  }
  return map;
}

export async function pendingNoticesFor(userId: number) {
  const notices = await pendingNoticeRows(userId);
  // The whole conversation on each report (21 Oct 2026): every comment on
  // it in the issue log — Graeme's messages and their own replies — so the
  // pop-up reads like a chat they can answer again and again.
  const ids = [...new Set(notices.map(n => n.andonIssueId))];
  const comments = ids.length === 0 ? [] : await db.select({
    id: andonCommentsTable.id, andonId: andonCommentsTable.andonId, userId: andonCommentsTable.userId,
    userName: andonCommentsTable.userName, comment: andonCommentsTable.comment, createdAt: andonCommentsTable.createdAt,
  }).from(andonCommentsTable).where(inArray(andonCommentsTable.andonId, ids));
  return notices.map(n => ({
    ...n,
    conversation: reporterConversation(comments.filter(c => c.andonId === n.andonIssueId), userId),
  }));
}

function pendingNoticeRows(userId: number) {
  return db.select({
    id: issueFixNoticesTable.id,
    andonIssueId: issueFixNoticesTable.andonIssueId,
    kind: issueFixNoticesTable.kind,
    quote: issueFixNoticesTable.quote,
    whatChanged: issueFixNoticesTable.whatChanged,
    testPath: issueFixNoticesTable.testPath,
    createdAt: issueFixNoticesTable.createdAt,
    reportedAt: andonIssuesTable.createdAt,
    station: andonIssuesTable.station,
  }).from(issueFixNoticesTable)
    .innerJoin(andonIssuesTable, eq(andonIssuesTable.id, issueFixNoticesTable.andonIssueId))
    .where(and(eq(issueFixNoticesTable.userId, userId), isNull(issueFixNoticesTable.acknowledgedAt)))
    .orderBy(asc(issueFixNoticesTable.createdAt));
}
