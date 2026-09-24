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
import { db, andonIssuesTable, issueTriageTable, type IssueTriage } from "@workspace/db";
import { and, asc, desc, eq, gte, isNull, type SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { validate } from "../middleware/validate";
import {
  AREA_FILTERS,
  LEVELS,
  MACHINE_TARGETS,
  TRIAGE_LANES,
  checkMachineToken,
  machineMoveVerdict,
  matchesAreaFilter,
  parseBearer,
  resolveIssueVerdict,
  retriageVerdict,
  validateTestPath,
  type TriageStatus,
} from "../lib/issue-pipeline-rules";
import {
  buildIssueViews,
  loadAndonRows,
  recordEvent,
  resolveIssueWithNotice,
  triageByIssueId,
  type ResolveOutcome,
} from "../lib/issue-pipeline-data";

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
    const conds: SQL[] = [];
    if (!includeResolved) conds.push(isNull(andonIssuesTable.resolvedAt));
    if (q.since) conds.push(gte(andonIssuesTable.createdAt, new Date(q.since)));
    const rows = await db.select().from(andonIssuesTable)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(andonIssuesTable.createdAt));

    const inArea = rows.filter(r => matchesAreaFilter(area, r.area, r.station));
    const triage = await triageByIssueId(inArea.map(r => r.id));
    // Default: only what still needs the session's attention — no triage row
    // yet, or Graeme replied and asked for another look.
    const wanted = inArea
      .filter(r => includeTriaged || !triage.has(r.id) || triage.get(r.id)!.awaitingRetriage)
      .slice(0, limit);

    const views = await buildIssueViews(wanted, machineAttachmentUrl);
    res.json({
      count: views.length,
      filters: { area, includeTriaged, includeResolved, since: q.since ?? null, limit },
      issues: views.map(v => ({ ...v, triage: triage.get(v.id) ?? null })),
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
  relatedIssueIds: z.array(z.number().int().positive()).max(100).default([]),
  causeTag: z.string().trim().max(100).nullable().optional(),
  triagedBy: z.string().trim().min(1).max(60).default("claude-code"),
  force: z.boolean().optional(),
});

router.post("/triage", validate(triageBody), async (req, res) => {
  const b = req.body as z.infer<typeof triageBody>;
  try {
    const [issue] = await db.select({ id: andonIssuesTable.id }).from(andonIssuesTable).where(eq(andonIssuesTable.id, b.andonIssueId));
    if (!issue) { res.status(404).json({ error: `Andon issue ${b.andonIssueId} not found` }); return; }

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
      .where(eq(issueTriageTable.status, status))
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
      const verdict = resolveIssueVerdict(current.status as TriageStatus, current.issueResolvedAt);
      if (!verdict.ok) return { status: 409 as const, error: verdict.error, triage: current };

      const resolverName = `${current.decidedBy ?? "Graeme"} (Fix queue)`;
      const opts = { triageId: current.id, resolverUserId: current.decidedByUserId, resolverName, whatChanged: b.whatChanged, testPath };

      const [issue] = await tx.select().from(andonIssuesTable).where(eq(andonIssuesTable.id, current.andonIssueId));
      if (!issue) return { status: 404 as const, error: "Andon issue not found" };
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
          outcomes.push(await resolveIssueWithNotice(tx, r, opts));
        }
      }

      const [row] = await tx.update(issueTriageTable)
        .set({ issueResolvedAt: new Date(), updatedAt: new Date() })
        .where(eq(issueTriageTable.id, id)).returning() as [IssueTriage];
      await recordEvent(tx, row, "issue_resolved", b.actor, b.whatChanged);
      return { status: 200 as const, triage: row, outcomes, skippedRelated };
    });
    if (out.status !== 200) { const { status, ...body } = out; res.status(status).json(body); return; }
    res.json({ ok: true, triage: out.triage, resolved: out.outcomes, skippedRelated: out.skippedRelated, testPath });
  } catch (err) {
    console.error("[issue-pipeline] resolve-issue failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Failed to resolve the issue" });
  }
});

// Anything else under /machine is a typo, not a reason to fall through to
// the session guard's confusing "Not authenticated".
router.use((_req, res) => { res.status(404).json({ error: "Unknown issue-pipeline machine endpoint" }); });

export default router;
