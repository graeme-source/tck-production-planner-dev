/**
 * Issue pipeline — the MACHINE API (docs/ISSUE_PIPELINE.md "Built").
 *
 * Called by a scheduled Claude Code session, not a person: it reads new app
 * issues from the Andon log, writes a recommendation per issue, reads back
 * what Graeme approved, reports progress, and — after Graeme has deployed —
 * resolves the issue and tells the reporter.
 *
 * Auth: `Authorization: Bearer <ISSUE_PIPELINE_TOKEN>`, compared in constant
 * time. No token configured = every endpoint answers 503. This router is
 * mounted in routes/index.ts ABOVE the app-wide session guard (next to the
 * public health/auth routes) because the session has no cookie; the token
 * middleware below is its only door, and it guards every path in here.
 *
 * Graeme's decisions are never written from here: approve / reject / reply
 * live in routes/issue-pipeline.ts behind the founder session gate.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db, andonIssuesTable, issueTriageTable, issueTriageEventsTable, type IssueTriage } from "@workspace/db";
import { and, asc, desc, eq, gte, inArray, isNull, or, type SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { validate } from "../middleware/validate";
import {
  AREA_FILTERS,
  LEVELS,
  MACHINE_TARGETS,
  TRIAGE_LANES,
  buildThread,
  checkMachineToken,
  machineIssueWanted,
  repliesFirst,
  unansweredReplies,
  machineMoveVerdict,
  parseBearer,
  pipelineMayHandle,
  resolveIssueVerdict,
  retriageVerdict,
  isSetAside,
  SET_ASIDE_ERROR,
  validateTestPath,
  type TriageStatus,
} from "../lib/issue-pipeline-rules";
import {
  buildIssueViews,
  loadAndonRows,
  recordEvent,
  creditImprovementIfDue,
  resolveIssueWithNotice,
  triageByIssueId,
  type ResolveOutcome,
} from "../lib/issue-pipeline-data";

import testRequestsMachineRouter from "./test-requests-machine";

const router: IRouter = Router();

// ── Token gate ──────────────────────────────────────────────────────────────
// Never log or echo the token — not the expected one, not the presented one.
function requireMachineToken(req: Request, res: Response, next: NextFunction) {
  const verdict = checkMachineToken(parseBearer(req.headers.authorization), process.env["ISSUE_PIPELINE_TOKEN"]);
  if (verdict === "disabled") {
    res.status(503).json({ error: "The issue pipeline machine API is disabled (ISSUE_PIPELINE_TOKEN is not configured)" });
    return;
  }
  if (verdict !== "ok") {
    res.status(401).json({ error: "Bad or missing pipeline token" });
    return;
  }
  next();
}
router.use(requireMachineToken);

// Forced testing: the deploy session attaches test requests (docs/FORCED_TESTING.md).
router.use("/test-requests", testRequestsMachineRouter);

const machineAttachmentUrl = (id: number) => `/api/issue-pipeline/machine/attachments/${id}`;

const boolParam = z.enum(["true", "false", "1", "0"]).transform(v => v === "true" || v === "1");

function parseQuery<S extends z.ZodTypeAny>(schema: S, req: Request, res: Response): z.output<S> | null {
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return null;
  }
  return parsed.data;
}

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── GET /issues ─────────────────────────────────────────────────────────────
const issuesQuery = z.object({
  since: z.string().datetime({ offset: true }).optional(),
  includeTriaged: boolParam.optional(),
  includeResolved: boolParam.optional(),
  area: z.enum(AREA_FILTERS).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

router.get("/issues", async (req, res) => {
  const q = parseQuery(issuesQuery, req, res);
  if (!q) return;
  const includeTriaged = q.includeTriaged ?? false;
  const includeResolved = q.includeResolved ?? false;
  const area = q.area ?? "app";
  const limit = q.limit ?? 100;
  try {
    // A card Graeme replied to is wanted even if its report is closed or
    // older than `since` ("Reply to Claude" works on Done cards too) — the
    // pure rule is machineIssueWanted; this SQL only narrows the read.
    const awaitingReply = sql`${andonIssuesTable.id} IN (SELECT andon_issue_id FROM issue_triage WHERE awaiting_retriage AND no_action_at IS NULL)`;
    const conds: SQL[] = [];
    if (!includeResolved) conds.push(isNull(andonIssuesTable.resolvedAt));
    if (q.since) conds.push(gte(andonIssuesTable.createdAt, new Date(q.since)));
    const rows = await db.select().from(andonIssuesTable)
      .where(conds.length ? or(and(...conds), awaitingReply) : undefined)
      .orderBy(desc(andonIssuesTable.createdAt));

    const triage = await triageByIssueId(rows.map(r => r.id));
    // Default: only what still needs the session's attention — no triage row
    // yet (in the chosen area), or Graeme replied and asked for another look
    // (any area, open or closed — see machineIssueWanted). Replies first.
    const wanted = repliesFirst(
      rows.filter(r => machineIssueWanted(area, r, triage.get(r.id), includeTriaged, includeResolved)),
      r => triage.get(r.id),
    ).slice(0, limit);

    // The conversation on each card, so a reply is read in context.
    const triageIds = wanted.map(r => triage.get(r.id)?.id).filter((x): x is number => x != null);
    const eventRows = triageIds.length === 0 ? [] : await db.select({
      triageId: issueTriageEventsTable.triageId,
      event: issueTriageEventsTable.event,
      note: issueTriageEventsTable.note,
      createdAt: issueTriageEventsTable.createdAt,
      snapshot: issueTriageEventsTable.snapshot,
    }).from(issueTriageEventsTable)
      .where(inArray(issueTriageEventsTable.triageId, triageIds))
      .orderBy(issueTriageEventsTable.createdAt, issueTriageEventsTable.id);
    const eventsByTriage = new Map<number, typeof eventRows>();
    for (const e of eventRows) {
      const list = eventsByTriage.get(e.triageId) ?? [];
      list.push(e);
      eventsByTriage.set(e.triageId, list);
    }

    const views = await buildIssueViews(wanted, machineAttachmentUrl);
    res.json({
      count: views.length,
      filters: { area, includeTriaged, includeResolved, since: q.since ?? null, limit },
      issues: views.map(v => {
        const t = triage.get(v.id) ?? null;
        const thread = t ? buildThread(eventsByTriage.get(t.id) ?? []) : [];
        const replies = t?.awaitingRetriage ? unansweredReplies(thread) : [];
        return {
          ...v,
          triage: t,
          thread,
          // Graeme's words since Claude last recommended — his newest,
          // overriding instruction for this re-triage (last one wins).
          graemeReply: t?.awaitingRetriage
            ? {
              instruction: "Graeme replied on the Fix queue. Treat his words as the newest, overriding instruction: re-triage this issue (POST /triage) with a recommendation that answers him directly. If he says your understanding was wrong, start again from his explanation.",
              latest: t.decisionNote,
              at: t.decidedAt,
              allSinceLastRecommendation: replies.map(r => ({ at: r.at, text: r.text })),
            }
            : null,
        };
      }),
    });
  } catch (err) {
    console.error("[issue-pipeline] machine issues failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Failed to load issues" });
  }
});

// ── GET /attachments/:id — the bytes, so the session can look at photos ────
router.get("/attachments/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.execute<{ mime: string; data: Buffer; file_name: string | null }>(
    sql`SELECT mime, data, file_name FROM andon_attachments WHERE id = ${id}`,
  );
  const a = rows.rows[0];
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  const buf = Buffer.isBuffer(a.data) ? a.data : Buffer.from(a.data);
  res.setHeader("Content-Type", a.mime);
  res.setHeader("Content-Length", String(buf.length));
  res.setHeader("Content-Disposition", `inline; filename="${(a.file_name || "attachment").replace(/["\r\n]/g, "")}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(buf);
});

// ── POST /triage — write (or refine) a recommendation ──────────────────────
const triageBody = z.object({
  andonIssueId: z.number().int().positive(),
  lane: z.enum(TRIAGE_LANES),
  verdictSummary: z.string().trim().min(1).max(500),
  explanation: z.string().max(20000).default(""),
  proposedFix: z.string().max(10000).default(""),
  objective: z.string().trim().max(40).nullable().optional(),
  blastRadius: z.enum(LEVELS),
  confidence: z.enum(LEVELS),
  noGoZone: z.boolean(),
  behaviourChange: z.boolean(),
  questionForGraeme: z.string().trim().max(2000).nullable().optional(),
  /** Draft message to the reporter — step-by-step instructions when they can
   *  fix it themselves in the app. Pre-fills Graeme's "Message the reporter". */
  suggestedReply: z.string().trim().max(4000).nullable().optional(),
  /** Already fixed / built / withdrawn / not a problem: the Fix queue shows
   *  "Dismiss — already done" instead of Approve. */
  noActionNeeded: z.boolean().optional(),
  /** The day the fix/feature went live (YYYY-MM-DD) — the credited
   *  improvement's done date when this report closes. */
  completedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  relatedIssueIds: z.array(z.number().int().positive()).max(100).default([]),
  causeTag: z.string().trim().max(100).nullable().optional(),
  triagedBy: z.string().trim().min(1).max(60).default("claude-code"),
  force: z.boolean().optional(),
});

router.post("/triage", validate(triageBody), async (req, res) => {
  const b = req.body as z.infer<typeof triageBody>;
  try {
    const [issue] = await db.select({ id: andonIssuesTable.id, category: andonIssuesTable.category, area: andonIssuesTable.area })
      .from(andonIssuesTable).where(eq(andonIssuesTable.id, b.andonIssueId));
    if (!issue) { res.status(404).json({ error: `Andon issue ${b.andonIssueId} not found` }); return; }
    const eligible = pipelineMayHandle(issue);
    if (!eligible.ok) { res.status(422).json({ error: eligible.error }); return; }

    const fields = {
      lane: b.lane,
      verdictSummary: b.verdictSummary,
      explanation: b.explanation,
      proposedFix: b.proposedFix,
      objective: b.objective || null,
      blastRadius: b.blastRadius,
      confidence: b.confidence,
      noGoZone: b.noGoZone,
      behaviourChange: b.behaviourChange,
      questionForGraeme: b.questionForGraeme || null,
      suggestedReply: b.suggestedReply || null,
      noActionNeeded: b.noActionNeeded ?? false,
      completedOn: b.completedOn ?? null,
      relatedIssueIds: [...new Set(b.relatedIssueIds.filter(id => id !== b.andonIssueId))],
      causeTag: b.causeTag || null,
      triagedBy: b.triagedBy,
      triagedAt: new Date(),
      updatedAt: new Date(),
      awaitingRetriage: false,
    };

    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(issueTriageTable)
        .where(eq(issueTriageTable.andonIssueId, b.andonIssueId)).for("update");
      // Dismissed with no action: refused even with force.
      if (isSetAside(current)) return { setAside: true as const, triage: current! };
      const verdict = retriageVerdict((current?.status as TriageStatus | undefined) ?? null, b.force ?? false);

      if (verdict.kind === "conflict") return { conflict: verdict.status, triage: current! };

      let row: IssueTriage;
      if (verdict.kind === "create") {
        [row] = await tx.insert(issueTriageTable).values({ andonIssueId: b.andonIssueId, ...fields }).returning() as [IssueTriage];
        await recordEvent(tx, row, "triaged", b.triagedBy);
      } else if (verdict.kind === "update") {
        [row] = await tx.update(issueTriageTable).set(fields).where(eq(issueTriageTable.id, current!.id)).returning() as [IssueTriage];
        await recordEvent(tx, row, "retriaged", b.triagedBy);
      } else {
        // Forced: the old decision is already in the history (every decision
        // wrote an event); this row goes back to Graeme as a fresh proposal.
        [row] = await tx.update(issueTriageTable).set({
          ...fields,
          status: "proposed",
          decidedBy: null, decidedByUserId: null, decidedAt: null, decisionNote: null,
          fixRef: null, fixedAt: null, issueResolvedAt: null,
        }).where(eq(issueTriageTable.id, current!.id)).returning() as [IssueTriage];
        await recordEvent(tx, row, "retriaged", b.triagedBy, `Forced re-triage — replaced a '${verdict.previousStatus}' decision`);
      }
      return { triage: row, created: verdict.kind === "create", replacedStatus: verdict.kind === "forced_reset" ? verdict.previousStatus : null };
    });

    if ("setAside" in result) {
      res.status(409).json({ error: SET_ASIDE_ERROR, currentStatus: result.triage.status, triage: result.triage });
      return;
    }
    if ("conflict" in result) {
      res.status(409).json({
        error: `Issue ${b.andonIssueId} already has a '${result.conflict}' recommendation — Graeme's decision stands. Send force: true to put a new recommendation in front of him (the old decision is kept in history).`,
        currentStatus: result.conflict,
        triage: result.triage,
      });
      return;
    }
    res.status(result.created ? 201 : 200).json(result);
  } catch (err) {
    console.error("[issue-pipeline] triage write failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Failed to save triage" });
  }
});

// ── GET /approved — the work queue ──────────────────────────────────────────
const approvedQuery = z.object({
  status: z.enum(["approved", "in_progress", "fixed"]).optional(),
});

router.get("/approved", async (req, res) => {
  const q = parseQuery(approvedQuery, req, res);
  if (!q) return;
  const status = q.status ?? "approved";
  try {
    const rows = await db.select().from(issueTriageTable)
      .where(and(eq(issueTriageTable.status, status), isNull(issueTriageTable.noActionAt)))
      .orderBy(asc(issueTriageTable.decidedAt), asc(issueTriageTable.id));
    const issues = await buildIssueViews(await loadAndonRows(rows.map(r => r.andonIssueId)), machineAttachmentUrl);
    const byId = new Map(issues.map(i => [i.id, i]));
    res.json({
      status,
      count: rows.length,
      items: rows.map(t => ({ triage: t, issue: byId.get(t.andonIssueId) ?? null })),
    });
  } catch (err) {
    console.error("[issue-pipeline] approved queue failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Failed to load the approved queue" });
  }
});

// ── POST /triage/:id/status — in_progress / fixed / wont_fix ───────────────
const statusBody = z.object({
  status: z.enum(MACHINE_TARGETS),
  fixRef: z.string().trim().max(500).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  actor: z.string().trim().min(1).max(60).default("claude-code"),
});

router.post("/triage/:id/status", validate(statusBody), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = req.body as z.infer<typeof statusBody>;
  try {
    const out = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(issueTriageTable).where(eq(issueTriageTable.id, id)).for("update");
      if (!current) return { status: 404 as const, error: "Triage not found" };
      if (isSetAside(current)) return { status: 409 as const, error: SET_ASIDE_ERROR, triage: current };
      const verdict = machineMoveVerdict(current.status as TriageStatus, b.status, {
        fixRef: b.fixRef ?? current.fixRef, note: b.note, issueResolved: !!current.issueResolvedAt,
      });
      if (!verdict.ok) return { status: 409 as const, error: verdict.error, triage: current };
      const [row] = await tx.update(issueTriageTable).set({
        status: b.status,
        fixRef: b.fixRef ?? current.fixRef,
        fixedAt: b.status === "fixed" ? (current.status === "fixed" ? current.fixedAt : new Date()) : null,
        updatedAt: new Date(),
      }).where(eq(issueTriageTable.id, id)).returning() as [IssueTriage];
      await recordEvent(tx, row, `status:${b.status}`, b.actor, b.note ?? null);
      return { status: 200 as const, triage: row };
    });
    if (out.status !== 200) { const { status, ...body } = out; res.status(status).json(body); return; }
    res.json({ triage: out.triage });
  } catch (err) {
    console.error("[issue-pipeline] status move failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Failed to update status" });
  }
});

// ── POST /triage/:id/resolve-issue — after Graeme has deployed ─────────────
const resolveBody = z.object({
  whatChanged: z.string().trim().min(1).max(1000),
  testPath: z.string().max(300).nullable().optional()
    .refine(p => p == null || p.trim() === "" || validateTestPath(p) !== null, {
      message: "testPath must be an in-app path starting with a single '/' (no external URLs, no /api)",
    }),
  alsoResolveRelated: z.boolean().optional(),
  actor: z.string().trim().min(1).max(60).default("claude-code"),
});

router.post("/triage/:id/resolve-issue", validate(resolveBody), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = req.body as z.infer<typeof resolveBody>;
  const testPath = validateTestPath(b.testPath);
  try {
    const out = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(issueTriageTable).where(eq(issueTriageTable.id, id)).for("update");
      if (!current) return { status: 404 as const, error: "Triage not found" };
      if (isSetAside(current)) return { status: 409 as const, error: SET_ASIDE_ERROR, triage: current };
      const verdict = resolveIssueVerdict(current.status as TriageStatus, current.issueResolvedAt);
      if (!verdict.ok) return { status: 409 as const, error: verdict.error, triage: current };

      const resolverName = `${current.decidedBy ?? "Graeme"} (Fix queue)`;
      const opts = { triageId: current.id, resolverUserId: current.decidedByUserId, resolverName, whatChanged: b.whatChanged, testPath };

      const [issue] = await tx.select().from(andonIssuesTable).where(eq(andonIssuesTable.id, current.andonIssueId));
      if (!issue) return { status: 404 as const, error: "Andon issue not found" };
      const eligible = pipelineMayHandle(issue);
      if (!eligible.ok) return { status: 422 as const, error: eligible.error, triage: current };
      const outcomes: ResolveOutcome[] = [await resolveIssueWithNotice(tx, issue, opts)];

      // Duplicates the session clustered under this fix. One that carries
      // its own recommendation is left alone — it gets resolved through its
      // own row, so its status never goes stale.
      const skippedRelated: Array<{ issueId: number; reason: string }> = [];
      if (b.alsoResolveRelated && current.relatedIssueIds.length > 0) {
        const related = await tx.select().from(andonIssuesTable)
          .where(sql`${andonIssuesTable.id} IN (${sql.join(current.relatedIssueIds.map(i => sql`${i}`), sql`, `)})`);
        const ownRows = await tx.select({ andonIssueId: issueTriageTable.andonIssueId }).from(issueTriageTable)
          .where(sql`${issueTriageTable.andonIssueId} IN (${sql.join(current.relatedIssueIds.map(i => sql`${i}`), sql`, `)})`);
        const hasOwn = new Set(ownRows.map(r => r.andonIssueId));
        for (const rid of current.relatedIssueIds) {
          const r = related.find(x => x.id === rid);
          if (!r) { skippedRelated.push({ issueId: rid, reason: "not found" }); continue; }
          if (hasOwn.has(rid)) { skippedRelated.push({ issueId: rid, reason: "has its own triage row — resolve it through that recommendation" }); continue; }
          if (r.resolvedAt) { skippedRelated.push({ issueId: rid, reason: "already resolved" }); continue; }
          const relEligible = pipelineMayHandle(r);
          if (!relEligible.ok) { skippedRelated.push({ issueId: rid, reason: relEligible.error }); continue; }
          outcomes.push(await resolveIssueWithNotice(tx, r, opts));
        }
      }

      const [row] = await tx.update(issueTriageTable)
        .set({ issueResolvedAt: new Date(), updatedAt: new Date() })
        .where(eq(issueTriageTable.id, id)).returning() as [IssueTriage];
      await recordEvent(tx, row, "issue_resolved", b.actor, b.whatChanged);
      // An improvement to the system, now live: credit the reporter.
      await creditImprovementIfDue(tx, row, current.decidedBy ?? "Graeme");
      return { status: 200 as const, triage: row, outcomes, skippedRelated };
    });
    if (out.status !== 200) { const { status, ...body } = out; res.status(status).json(body); return; }
    res.json({ ok: true, triage: out.triage, resolved: out.outcomes, skippedRelated: out.skippedRelated, testPath });
  } catch (err) {
    console.error("[issue-pipeline] resolve-issue failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Failed to resolve the issue" });
  }
});

// ── POST /triage/:id/completed-on {completedOn} ────────────────────────────
// Record the day a fix/feature went live, at any status — so an improvement
// credited for an old report is dated when it was really built.
const completedOnBody = z.object({ completedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
router.post("/triage/:id/completed-on", validate(completedOnBody), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.update(issueTriageTable)
    .set({ completedOn: (req.body as z.infer<typeof completedOnBody>).completedOn, updatedAt: new Date() })
    .where(eq(issueTriageTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Triage not found" }); return; }
  res.json({ triage: row });
});

// ── POST /credit-improvements ────────────────────────────────────────────────
// Catch-up sweep, safe to call every run: any closed improvement-lane report
// not yet credited gets its completed improvement in the reporter's name.
router.post("/credit-improvements", async (_req, res) => {
  try {
    const rows = await db.select().from(issueTriageTable)
      .where(sql`${issueTriageTable.lane} = 'improvement' AND ${issueTriageTable.improvementId} IS NULL
        AND ${issueTriageTable.status} IN ('fixed', 'answered', 'dismissed') AND ${issueTriageTable.noActionAt} IS NULL`);
    const credited: Array<{ andonIssueId: number; improvementId: number }> = [];
    for (const r of rows) {
      const improvementId = await db.transaction(tx => creditImprovementIfDue(tx, r, r.decidedBy ?? "Graeme"));
      if (improvementId) credited.push({ andonIssueId: r.andonIssueId, improvementId });
    }
    res.json({ checked: rows.length, credited });
  } catch (err) {
    console.error("[issue-pipeline] credit sweep failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Credit sweep failed" });
  }
});

// ── POST /issues/:andonIssueId/note — a note from Claude onto the card ─────
// (Graeme, 2026-10-12.) Claude telling GRAEME something on a Fix queue card
// — "This is fixed — …", "Deployed in 1a2b3c", "Still looking" — without
// re-triaging it or touching its status, decision, or the reporter. It shows
// in the card's Conversation as "Claude". Keyed by the andon issue number
// Graeme sees on the card ("Issue #318"). To tell the REPORTER, use
// resolve-issue (after a deploy) instead.
const noteBody = z.object({
  note: z.string().trim().min(1).max(4000),
  actor: z.string().trim().min(1).max(60).default("claude-code"),
});

router.post("/issues/:andonIssueId/note", validate(noteBody), async (req, res) => {
  const issueId = parseId(req.params.andonIssueId);
  if (!issueId) { res.status(400).json({ error: "Invalid issue id" }); return; }
  const b = req.body as z.infer<typeof noteBody>;
  try {
    const [current] = await db.select().from(issueTriageTable).where(eq(issueTriageTable.andonIssueId, issueId));
    if (!current) { res.status(404).json({ error: `Issue #${issueId} has no Fix queue card yet — POST /triage first` }); return; }
    if (isSetAside(current)) { res.status(409).json({ error: SET_ASIDE_ERROR, triage: current }); return; }
    await recordEvent(db, current, "claude_note", b.actor, b.note);
    res.status(201).json({ ok: true, triageId: current.id, andonIssueId: issueId });
  } catch (err) {
    console.error("[issue-pipeline] note failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Failed to post the note" });
  }
});

// Anything else under /machine is a typo, not a reason to fall through to
// the session guard's confusing "Not authenticated".
router.use((_req, res) => { res.status(404).json({ error: "Unknown issue-pipeline machine endpoint" }); });

export default router;
