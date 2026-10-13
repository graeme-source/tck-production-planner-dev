// Accident & incident diary — HACCP due diligence (Graeme, 2026-09-11).
//
// A report is created empty and auto-dated the moment the manager taps
// "New report", then filled in field by field (the diary UI autosaves on
// blur). The standard containment steps are explicit booleans so the diary
// shows due diligence at a glance, and a signature records who stands
// behind the report. Mounted behind the admin-or-manager guard in
// routes/index.ts — this is a manager's tool.

import { Router, type IRouter, type Request, type Response } from "express";
import { db, incidentReportsTable, incidentAttachmentsTable, usersTable } from "@workspace/db";
import { eq, desc, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { singleFileUpload } from "../middleware/upload";
import {
  incidentMediaKind,
  incidentUploadProblem,
  isAddedAfterSigning,
  canRemoveIncidentAttachment,
  canDeleteIncidentReport,
  INCIDENT_VIDEO_MAX_MB,
} from "../lib/incident-attachment-rules";

const router: IRouter = Router();

async function sessionUser(req: Request): Promise<{ id: number; name: string } | null> {
  const id = req.session.userId ?? null;
  if (!id) return null;
  const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
  return u ?? null;
}

// GET / — the diary, newest first.
router.get("/", async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(incidentReportsTable).orderBy(desc(incidentReportsTable.occurredAt), desc(incidentReportsTable.id));
    // Live (not removed) photo/video count per report, for the card header.
    const counts = await db
      .select({ incidentId: incidentAttachmentsTable.incidentId, n: sql<number>`count(*)::int` })
      .from(incidentAttachmentsTable)
      .where(sql`${incidentAttachmentsTable.deletedAt} IS NULL`)
      .groupBy(incidentAttachmentsTable.incidentId);
    const byId = new Map(counts.map(c => [c.incidentId, Number(c.n)]));
    res.json(rows.map(r => ({ ...r, attachmentCount: byId.get(r.id) ?? 0 })));
  } catch (err) {
    console.error("[incidents] list failed:", err);
    res.status(500).json({ error: "Failed to load the incident diary" });
  }
});

// POST / — start a report. Auto-dated, reporter recorded; everything else
// is filled in afterwards via PATCH autosaves.
router.post("/", validate(z.object({ kind: z.enum(["accident", "incident", "near_miss"]).optional() })), async (req: Request, res: Response) => {
  try {
    const user = await sessionUser(req);
    if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
    const [row] = await db
      .insert(incidentReportsTable)
      .values({
        kind: (req.body as { kind?: string }).kind ?? "incident",
        reportedByUserId: user.id,
        reportedByName: user.name,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[incidents] create failed:", err);
    res.status(500).json({ error: "Failed to create the report" });
  }
});

const PatchBody = z.object({
  kind: z.enum(["accident", "incident", "near_miss"]).optional(),
  occurredAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)).optional(),
  title: z.string().max(300).optional(),
  location: z.string().max(300).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  peopleInvolved: z.string().max(2000).nullable().optional(),
  injuries: z.string().max(5000).nullable().optional(),
  foodSafetyImpact: z.string().max(5000).nullable().optional(),
  immediateActions: z.string().max(5000).nullable().optional(),
  correctiveActions: z.string().max(5000).nullable().optional(),
  productionStopped: z.boolean().optional(),
  foodDiscarded: z.boolean().optional(),
  riskAssessmentDone: z.boolean().optional(),
  areaCleaned: z.boolean().optional(),
});

// PATCH /:id — field-level autosave from the diary form.
router.patch("/:id", validate(PatchBody), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const body = req.body as z.infer<typeof PatchBody>;
    const set: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      set[k] = k === "occurredAt" ? new Date(v as string) : v;
    }
    const [row] = await db.update(incidentReportsTable).set(set).where(eq(incidentReportsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Report not found" }); return; }
    res.json(row);
  } catch (err) {
    console.error("[incidents] patch failed:", err);
    res.status(500).json({ error: "Failed to save" });
  }
});

// POST /:id/sign — the signed-in manager puts their name to the report.
router.post("/:id/sign", validate(z.object({})), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const user = await sessionUser(req);
    if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
    const [row] = await db
      .update(incidentReportsTable)
      .set({ signedByUserId: user.id, signedByName: user.name, signedAt: new Date(), updatedAt: new Date() })
      .where(eq(incidentReportsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Report not found" }); return; }
    res.json(row);
  } catch (err) {
    console.error("[incidents] sign failed:", err);
    res.status(500).json({ error: "Failed to sign" });
  }
});

// POST /:id/close — mark resolved (and reopen with { reopen: true }).
router.post("/:id/close", validate(z.object({ reopen: z.boolean().optional() })), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const reopen = Boolean((req.body as { reopen?: boolean }).reopen);
    const [row] = await db
      .update(incidentReportsTable)
      .set(reopen ? { status: "open", closedAt: null, updatedAt: new Date() } : { status: "closed", closedAt: new Date(), updatedAt: new Date() })
      .where(eq(incidentReportsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Report not found" }); return; }
    res.json(row);
  } catch (err) {
    console.error("[incidents] close failed:", err);
    res.status(500).json({ error: "Failed to update" });
  }
});

// DELETE /:id — admins only would be nicer, but a manager deleting an
// empty accidental draft is the real use; deleting a signed report is
// blocked so the diary stays honest.
router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [existing] = await db.select({ signedAt: incidentReportsTable.signedAt }).from(incidentReportsTable).where(eq(incidentReportsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Report not found" }); return; }
    // Any attachment row — even a removed one — is evidence, so a report
    // holding one can't go (the FK is ON DELETE RESTRICT as a backstop).
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(incidentAttachmentsTable)
      .where(eq(incidentAttachmentsTable.incidentId, id));
    const verdict = canDeleteIncidentReport(existing.signedAt, Number(n));
    if (!verdict.ok) { res.status(409).json({ error: verdict.error }); return; }
    await db.delete(incidentReportsTable).where(eq(incidentReportsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[incidents] delete failed:", err);
    res.status(500).json({ error: "Failed to delete" });
  }
});

// ── Photos & videos (migration 0188, Graeme 2026-10-13) ────────────────────
// HACCP evidence. Uploads never touch the report row, so a signed report's
// content stays exactly as signed; a photo added after signing is marked
// "added after signing" with who and when. Removal is a soft delete.

const toIso = (d: Date | string | null) => (d == null ? null : d instanceof Date ? d.toISOString() : d);

// GET /:id/attachments — metadata (no bytes), removed ones included so the
// diary can show what was taken off, by whom and why.
router.get("/:id/attachments", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const rows = await db
      .select({
        id: incidentAttachmentsTable.id,
        kind: incidentAttachmentsTable.kind,
        mime: incidentAttachmentsTable.mime,
        fileName: incidentAttachmentsTable.fileName,
        sizeBytes: incidentAttachmentsTable.sizeBytes,
        uploadedByUserId: incidentAttachmentsTable.uploadedByUserId,
        uploadedByName: incidentAttachmentsTable.uploadedByName,
        addedAfterSigning: incidentAttachmentsTable.addedAfterSigning,
        createdAt: incidentAttachmentsTable.createdAt,
        deletedAt: incidentAttachmentsTable.deletedAt,
        deletedByName: incidentAttachmentsTable.deletedByName,
        deleteReason: incidentAttachmentsTable.deleteReason,
      })
      .from(incidentAttachmentsTable)
      .where(eq(incidentAttachmentsTable.incidentId, id))
      .orderBy(asc(incidentAttachmentsTable.createdAt), asc(incidentAttachmentsTable.id));
    res.json(rows.map(r => ({ ...r, createdAt: toIso(r.createdAt), deletedAt: toIso(r.deletedAt) })));
  } catch (err) {
    console.error("[incidents] attachments list failed:", err);
    res.status(500).json({ error: "Failed to load photos" });
  }
});

// POST /:id/attachments — one photo or short video (multipart "file").
router.post(
  "/:id/attachments",
  singleFileUpload("file", INCIDENT_VIDEO_MAX_MB),
  validate(z.object({})),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    try {
      const user = await sessionUser(req);
      if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
      if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
      const problem = incidentUploadProblem(req.file.mimetype, req.file.size);
      if (problem) { res.status(400).json({ error: problem }); return; }
      const [report] = await db
        .select({ signedAt: incidentReportsTable.signedAt })
        .from(incidentReportsTable)
        .where(eq(incidentReportsTable.id, id));
      if (!report) { res.status(404).json({ error: "Report not found" }); return; }
      const [row] = await db
        .insert(incidentAttachmentsTable)
        .values({
          incidentId: id,
          kind: incidentMediaKind(req.file.mimetype)!,
          mime: req.file.mimetype,
          data: req.file.buffer,
          fileName: req.file.originalname ?? null,
          sizeBytes: req.file.size,
          uploadedByUserId: user.id,
          uploadedByName: user.name,
          addedAfterSigning: isAddedAfterSigning(report.signedAt),
        })
        .returning({
          id: incidentAttachmentsTable.id,
          kind: incidentAttachmentsTable.kind,
          addedAfterSigning: incidentAttachmentsTable.addedAfterSigning,
        });
      res.status(201).json(row);
    } catch (err) {
      console.error("[incidents] attachment upload failed:", err);
      res.status(500).json({ error: "The photo didn't save — try again." });
    }
  },
);

// GET /attachments/:attId — the bytes, inline (also for removed ones: the
// evidence is kept and an auditor may need to see it).
router.get("/attachments/:attId", async (req: Request, res: Response) => {
  const attId = Number(req.params.attId);
  if (!Number.isInteger(attId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db
      .select({ mime: incidentAttachmentsTable.mime, data: incidentAttachmentsTable.data, kind: incidentAttachmentsTable.kind })
      .from(incidentAttachmentsTable)
      .where(eq(incidentAttachmentsTable.id, attId));
    if (!row || !row.data) { res.status(404).json({ error: "Not found" }); return; }
    res.setHeader("Content-Type", row.mime);
    res.setHeader("Cache-Control", "private, max-age=300");
    if (row.kind === "video") res.setHeader("Accept-Ranges", "bytes");
    res.send(row.data);
  } catch (err) {
    console.error("[incidents] attachment read failed:", err);
    res.status(500).json({ error: "Failed to load the photo" });
  }
});

// POST /attachments/:attId/remove — soft delete, audited on the row. The
// uploader or a manager/admin; the bytes are never thrown away.
router.post(
  "/attachments/:attId/remove",
  validate(z.object({ reason: z.string().trim().max(500).optional() })),
  async (req: Request, res: Response) => {
    const attId = Number(req.params.attId);
    if (!Number.isInteger(attId)) { res.status(400).json({ error: "Invalid id" }); return; }
    try {
      const user = await sessionUser(req);
      if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
      const [att] = await db
        .select({ uploadedByUserId: incidentAttachmentsTable.uploadedByUserId, deletedAt: incidentAttachmentsTable.deletedAt })
        .from(incidentAttachmentsTable)
        .where(eq(incidentAttachmentsTable.id, attId));
      if (!att) { res.status(404).json({ error: "Not found" }); return; }
      const verdict = canRemoveIncidentAttachment({
        viewerUserId: user.id,
        viewerRole: req.session.userRole,
        uploadedByUserId: att.uploadedByUserId,
        deletedAt: att.deletedAt,
      });
      if (!verdict.ok) { res.status(verdict.status).json({ error: verdict.error }); return; }
      const reason = (req.body as { reason?: string }).reason?.trim() || null;
      await db
        .update(incidentAttachmentsTable)
        .set({ deletedAt: new Date(), deletedByUserId: user.id, deletedByName: user.name, deleteReason: reason })
        .where(sql`${incidentAttachmentsTable.id} = ${attId} AND ${incidentAttachmentsTable.deletedAt} IS NULL`);
      console.log(`[incidents] attachment ${attId} removed by ${user.name} (${user.id})${reason ? `: ${reason}` : ""}`);
      res.json({ ok: true });
    } catch (err) {
      console.error("[incidents] attachment remove failed:", err);
      res.status(500).json({ error: "Failed to remove" });
    }
  },
);

export default router;
