/**
 * "Suggested from improvements" in the Fix queue — the database half
 * (Graeme, 2026-10-10). The rules are pure, in improvement-app-request.ts.
 *
 * scanNewIdeas()  checks every recent open idea not checked before, once,
 *                 and records the verdict (flagged or not) so it is never
 *                 re-checked or re-suggested.
 * decide()        Graeme's Add to fix queue / Dismiss / Restore. "Add"
 *                 makes an app issue in the idea's words, reported by
 *                 whoever logged it, already acknowledged (so it doesn't
 *                 sit on the dashboard as a new problem) and joined to the
 *                 idea — the hourly Claude session triages it like any
 *                 other, and when it's fixed the idea is credited
 *                 (creditImprovementIfDue). Nobody is messaged at any step.
 */
import { db, andonIssuesTable, improvementFixSuggestionsTable, improvementSubmissionsTable, usersTable } from "@workspace/db";
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { APP_AREA_VALUE, APP_STATION_NAME } from "./issue-pipeline-rules";
import { ideaGoesToFixQueue, ideaWantsScan, issueTextFromIdea, looksLikeAppRequest, suggestionMove, type SuggestionStatus } from "./improvement-app-request";

const SCAN_DAYS = 30;

export async function scanNewIdeas(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - SCAN_DAYS * 24 * 60 * 60 * 1000);
  const ideas = await db.select({
    id: improvementSubmissionsTable.id,
    title: improvementSubmissionsTable.title,
    description: improvementSubmissionsTable.description,
    station: improvementSubmissionsTable.station,
    progressStatus: improvementSubmissionsTable.progressStatus,
    createdAt: improvementSubmissionsTable.createdAt,
  }).from(improvementSubmissionsTable)
    .where(and(
      gte(improvementSubmissionsTable.createdAt, since),
      sql`NOT EXISTS (SELECT 1 FROM improvement_fix_suggestions s WHERE s.improvement_id = ${improvementSubmissionsTable.id})`,
    ));
  if (!ideas.length) return 0;
  const linked = new Set((await db.select({ id: andonIssuesTable.improvementId }).from(andonIssuesTable)
    .where(and(isNotNull(andonIssuesTable.improvementId), inArray(andonIssuesTable.improvementId, ideas.map(i => i.id))))).map(r => r.id));
  const rows = ideas
    .filter(i => ideaWantsScan({ progressStatus: i.progressStatus, createdAt: i.createdAt, linkedToIssue: linked.has(i.id) }, now, SCAN_DAYS))
    .map(i => {
      const v = looksLikeAppRequest(i);
      return { improvementId: i.id, flagged: v.flagged, reasons: v.reasons, status: v.flagged ? "suggested" : "not_flagged" };
    });
  if (!rows.length) return 0;
  await db.insert(improvementFixSuggestionsTable).values(rows).onConflictDoNothing();
  return rows.filter(r => r.flagged).length;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** An idea becomes an app report on the Fix queue, in its own words,
 *  reported by whoever logged it, already acknowledged so it doesn't sit on
 *  the dashboard as a new problem. Nobody is messaged. */
async function ideaToIssue(tx: Tx, idea: typeof improvementSubmissionsTable.$inferSelect, by: { name: string; userId: number | null; how: string }): Promise<number> {
  const [issue] = await tx.insert(andonIssuesTable).values({
    category: "other",
    severity: "green",
    description: issueTextFromIdea(idea),
    station: APP_STATION_NAME,
    area: APP_AREA_VALUE,
    reportedBy: idea.submittedBy,
    reportedByName: idea.submittedByName,
    reportContext: `From improvement idea #${idea.id}, ${by.how}`,
    acknowledgedBy: by.userId,
    acknowledgedByName: by.name,
    acknowledgedAt: new Date(),
    improvementId: idea.id,
  }).returning({ id: andonIssuesTable.id });
  return issue!.id;
}

/**
 * Every new idea onto the Fix queue (Graeme, 26 Nov 2026) — the hourly
 * reviewer then assesses each and proposes a fix, or a practical suggestion
 * when it isn't about the app. Run by the reviewer's issue list, so ideas
 * are in before it looks. Dismissed ones stay dismissed; each goes in once.
 */
export async function addNewIdeasToFixQueue(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - SCAN_DAYS * 24 * 60 * 60 * 1000);
  const ideas = await db.select().from(improvementSubmissionsTable)
    .where(and(gte(improvementSubmissionsTable.createdAt, since), isNull(improvementSubmissionsTable.assignedTo)));
  if (!ideas.length) return 0;
  const ids = ideas.map(i => i.id);
  const linked = new Set((await db.select({ id: andonIssuesTable.improvementId }).from(andonIssuesTable)
    .where(and(isNotNull(andonIssuesTable.improvementId), inArray(andonIssuesTable.improvementId, ids)))).map(r => r.id));
  const seen = new Map((await db.select({ improvementId: improvementFixSuggestionsTable.improvementId, status: improvementFixSuggestionsTable.status })
    .from(improvementFixSuggestionsTable).where(inArray(improvementFixSuggestionsTable.improvementId, ids))).map(r => [r.improvementId, r.status]));
  let added = 0;
  for (const idea of ideas) {
    if (!ideaGoesToFixQueue({ ...idea, linkedToIssue: linked.has(idea.id), suggestionStatus: seen.get(idea.id) ?? null }, now, SCAN_DAYS)) continue;
    await db.transaction(async tx => {
      const andonIssueId = await ideaToIssue(tx, idea, { name: "Fix queue", userId: null, how: "added to the Fix queue automatically" });
      const v = looksLikeAppRequest(idea);
      await tx.insert(improvementFixSuggestionsTable).values({
        improvementId: idea.id, flagged: true, reasons: v.reasons, status: "added", andonIssueId,
        decidedBy: "Automatically", decidedAt: new Date(),
      }).onConflictDoUpdate({
        target: improvementFixSuggestionsTable.improvementId,
        set: { flagged: true, status: "added", andonIssueId, decidedBy: "Automatically", decidedAt: new Date() },
      });
    });
    added++;
  }
  return added;
}

export async function listSuggestions(status: "suggested" | "dismissed") {
  return db.select({
    id: improvementFixSuggestionsTable.id,
    improvementId: improvementFixSuggestionsTable.improvementId,
    reasons: improvementFixSuggestionsTable.reasons,
    status: improvementFixSuggestionsTable.status,
    decidedBy: improvementFixSuggestionsTable.decidedBy,
    decidedAt: improvementFixSuggestionsTable.decidedAt,
    scannedAt: improvementFixSuggestionsTable.scannedAt,
    title: improvementSubmissionsTable.title,
    description: improvementSubmissionsTable.description,
    station: improvementSubmissionsTable.station,
    submittedByName: improvementSubmissionsTable.submittedByName,
    createdAt: improvementSubmissionsTable.createdAt,
  }).from(improvementFixSuggestionsTable)
    .innerJoin(improvementSubmissionsTable, eq(improvementSubmissionsTable.id, improvementFixSuggestionsTable.improvementId))
    .where(and(eq(improvementFixSuggestionsTable.flagged, true), eq(improvementFixSuggestionsTable.status, status)))
    .orderBy(desc(improvementSubmissionsTable.createdAt))
    .limit(100);
}

export type DecideOutcome = { ok: true; status: SuggestionStatus; andonIssueId: number | null } | { ok: false; status: 404 | 409; error: string };

export async function decideSuggestion(id: number, action: "add" | "dismiss" | "restore", actor: { userId: number }): Promise<DecideOutcome> {
  const [actorRow] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, actor.userId));
  const actorName = actorRow?.name ?? "Graeme";
  return db.transaction(async tx => {
    const [s] = await tx.select().from(improvementFixSuggestionsTable).where(eq(improvementFixSuggestionsTable.id, id)).for("update");
    if (!s || !s.flagged) return { ok: false as const, status: 404 as const, error: "Suggestion not found" };
    const to = suggestionMove(s.status, action);
    if (!to) return { ok: false as const, status: 409 as const, error: s.status === "added" ? "Already in the Fix queue" : `Can't ${action} a ${s.status} suggestion` };
    let andonIssueId: number | null = s.andonIssueId;
    if (action === "add") {
      const [idea] = await tx.select().from(improvementSubmissionsTable).where(eq(improvementSubmissionsTable.id, s.improvementId));
      if (!idea) return { ok: false as const, status: 404 as const, error: "The improvement no longer exists" };
      andonIssueId = await ideaToIssue(tx, idea, { name: actorName, userId: actor.userId, how: `added to the Fix queue by ${actorName}` });
    }
    await tx.update(improvementFixSuggestionsTable).set({
      status: to,
      andonIssueId,
      decidedBy: action === "restore" ? null : actorName,
      decidedByUserId: action === "restore" ? null : actor.userId,
      decidedAt: action === "restore" ? null : new Date(),
    }).where(eq(improvementFixSuggestionsTable.id, id));
    return { ok: true as const, status: to, andonIssueId };
  });
}
