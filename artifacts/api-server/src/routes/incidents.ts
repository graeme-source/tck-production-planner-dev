// Accident & incident diary — HACCP due diligence (Graeme, 2026-09-11).
//
// A report is created empty and auto-dated the moment the manager taps
// "New report", then filled in field by field (the diary UI autosaves on
// blur). The standard containment steps are explicit booleans so the diary
// shows due diligence at a glance, and a signature records who stands
// behind the report. Since 2026-11-19 anyone can dictate a report and
// work on their own; the diary, signing and unlocking stay with managers
// (see accessibleReport below).
//
// Lock (migration 0190, Graeme 2026-10-13): once signed, the report's
// fields are read-only (PATCH → 409) until a manager unlocks it with a
// reason; signing again re-locks it as the next version. Each signed
// version and each unlock is kept in incident_report_history. Rules:
// lib/incident-lock-rules.ts.

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db, incidentReportsTable, incidentAttachmentsTable, incidentReportHistoryTable, usersTable, suppliersTable, ingredientsTable,
  type IncidentReport,
} from "@workspace/db";
import { eq, desc, asc, sql, and, isNull } from "drizzle-orm";
import { requireManagerOrAdmin, resolveRole } from "../middleware/roles";
import { sendEmail, FROM_EMAIL } from "../lib/email";
import { shouldSkipSideEffect } from "../lib/app-env";
import { FOUNDER_EMAIL } from "../lib/founder-email";
import { readPackLabel } from "../services/pack-label-reader";
import {
  canAccessIncident, plainTextToHtml, supplierEmailSendRefusal, supplierEmailCc, MAX_DICTATION_CHARS, SUPPLIER_EMAIL_LIMITS,
  type IngredientOption, type PickOption,
} from "../lib/incident-dictation";
import { draftIncidentFromDictation, draftSupplierEmail } from "../services/incident-ai";
import { supplierEmailStep } from "../lib/incident-dictation";
import { londonDateString } from "../lib/london-time";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { singleFileUpload } from "../middleware/upload";
import { EMAIL_PHOTO_KIND,
  incidentMediaKind,
  incidentUploadProblem,
  isAddedAfterSigning,
  canRemoveIncidentAttachment,
  canDeleteIncidentReport,
  INCIDENT_VIDEO_MAX_MB,
} from "../lib/incident-attachment-rules";
import {
  incidentEditRefusal,
  incidentSignRefusal,
  incidentUnlockRefusal,
  snapshotIncident,
  buildIncidentHistory,
  LOCKED_EDIT_ERROR,
} from "../lib/incident-lock-rules";

const router: IRouter = Router();

// Who sees what (Graeme, 2026-11-19: "make it really easy for the team to
// report"). Anyone signed in can dictate a report, see and fill in the ones
// THEY reported, add photos and email the supplier. The diary list, signing,
// unlocking, closing and history stay with managers and admins. The router
// is mounted without a guard (routes/index.ts); each route checks here.

/** The report if the viewer may open it; otherwise the response is sent and null comes back. */
async function accessibleReport(req: Request, res: Response, id: number): Promise<IncidentReport | null> {
  const [row] = await db.select().from(incidentReportsTable).where(eq(incidentReportsTable.id, id));
  if (!row) { res.status(404).json({ error: "Report not found" }); return null; }
  const role = await resolveRole(req);
  if (!canAccessIncident({ viewerUserId: req.session.userId ?? null, viewerRole: role, reportedByUserId: row.reportedByUserId })) {
    res.status(403).json({ error: "Only the person who reported this, or a manager, can open it." });
    return null;
  }
  return row;
}

async function supplierOptions(): Promise<{ suppliers: Array<PickOption & { emailTo: string | null; recipientName: string | null }>; ingredients: IngredientOption[] }> {
  const sups = await db
    .select({
      id: suppliersTable.id, name: suppliersTable.name,
      accountManagerEmail: suppliersTable.accountManagerEmail, accountManagerName: suppliersTable.accountManagerName,
      email: suppliersTable.email, contactName: suppliersTable.contactName,
    })
    .from(suppliersTable)
    .orderBy(asc(suppliersTable.name));
  const ings = await db
    .select({ id: ingredientsTable.id, name: ingredientsTable.name, supplierId: ingredientsTable.supplierId, secondarySupplierId: ingredientsTable.secondarySupplierId })
    .from(ingredientsTable)
    .orderBy(asc(ingredientsTable.name));
  return {
    suppliers: sups.map(s => ({
      id: s.id,
      name: s.name,
      // The account manager first (the goods-in issue email goes there too).
      emailTo: s.accountManagerEmail?.trim() || s.email?.trim() || null,
      recipientName: s.accountManagerEmail?.trim() ? s.accountManagerName : s.contactName,
    })),
    ingredients: ings.map(i => ({
      id: i.id, name: i.name,
      supplierIds: [i.supplierId, i.secondarySupplierId].filter((x): x is number => x != null),
    })),
  };
}

/** What a sign/unlock transaction ends with: the updated row, or a refusal. */
type TxOutcome = { row: IncidentReport } | { status: number; error: string };

async function sessionUser(req: Request): Promise<{ id: number; name: string } | null> {
  const id = req.session.userId ?? null;
  if (!id) return null;
  const [u] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
  return u ?? null;
}

// GET / — the diary, newest first.
router.get("/", requireManagerOrAdmin, async (_req: Request, res: Response) => {
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

// GET /supplier-options — suppliers (with who an email would go to) and
// their products, for the "Which supplier?" step.
router.get("/supplier-options", async (_req: Request, res: Response) => {
  try {
    res.json(await supplierOptions());
  } catch (err) {
    console.error("[incidents] supplier options failed:", err);
    res.status(500).json({ error: "Failed to load suppliers" });
  }
});

// POST /dictate — the new first step. What was said is written up into the
// diary's fields by AI (only what was said; nothing ticked that wasn't
// done) and saved as a new report. The words themselves are kept on the
// report unedited. Without AI, the words become the description.
router.post(
  "/dictate",
  validate(z.object({ text: z.string().trim().min(3).max(MAX_DICTATION_CHARS) })),
  async (req: Request, res: Response) => {
    try {
      const user = await sessionUser(req);
      if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
      const text = (req.body as { text: string }).text.trim();
      const opts = await supplierOptions();
      const { draft, usedAi } = await draftIncidentFromDictation(text, opts.suppliers, opts.ingredients);
      const [row] = await db
        .insert(incidentReportsTable)
        .values({
          ...draft,
          dictation: text,
          reportedByUserId: user.id,
          reportedByName: user.name,
        })
        .returning();
      res.status(201).json({ ...row, attachmentCount: 0, usedAi });
    } catch (err) {
      console.error("[incidents] dictate failed:", err);
      res.status(500).json({ error: "Couldn't save the report — try again." });
    }
  },
);

// GET /:id — one report (the reporter's own, or any for a manager).
router.get("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const row = await accessibleReport(req, res, id);
    if (!row) return;
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(incidentAttachmentsTable)
      .where(and(eq(incidentAttachmentsTable.incidentId, id), isNull(incidentAttachmentsTable.deletedAt)));
    res.json({ ...row, attachmentCount: Number(n) });
  } catch (err) {
    console.error("[incidents] get failed:", err);
    res.status(500).json({ error: "Failed to load the report" });
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
  supplierIssue: z.boolean().optional(),
  supplierId: z.number().int().positive().nullable().optional(),
  ingredientId: z.number().int().positive().nullable().optional(),
  productBatchCode: z.string().trim().max(80).nullable().optional(),
  productUseBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

// PATCH /:id — field-level autosave from the diary form.
router.patch("/:id", validate(PatchBody), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const body = req.body as z.infer<typeof PatchBody>;
    if (!(await accessibleReport(req, res, id))) return;
    // Signed reports are locked (migration 0190): edits only after a
    // manager unlocks it with a reason.
    const [existing] = await db
      .select({ signedAt: incidentReportsTable.signedAt, unlockedAt: incidentReportsTable.unlockedAt })
      .from(incidentReportsTable)
      .where(eq(incidentReportsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Report not found" }); return; }
    const refusal = incidentEditRefusal(existing);
    if (refusal) { res.status(refusal.status).json({ error: refusal.error }); return; }
    const set: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      set[k] = k === "occurredAt" ? new Date(v as string) : v;
    }
    // The WHERE repeats the lock rule, so a signature landing between the
    // check and this write can't be overwritten.
    const [row] = await db
      .update(incidentReportsTable)
      .set(set)
      .where(and(
        eq(incidentReportsTable.id, id),
        sql`(${incidentReportsTable.signedAt} IS NULL OR ${incidentReportsTable.unlockedAt} IS NOT NULL)`,
      ))
      .returning();
    if (!row) { res.status(409).json({ error: LOCKED_EDIT_ERROR }); return; }
    res.json(row);
  } catch (err) {
    console.error("[incidents] patch failed:", err);
    res.status(500).json({ error: "Failed to save" });
  }
});

// POST /:id/sign — the signed-in manager puts their name to the report.
// Each signature is the next version (v1, v2…); its wording is kept as a
// snapshot in incident_report_history and the report locks. Signing a
// locked report is refused — unlock it first.
router.post("/:id/sign", requireManagerOrAdmin, validate(z.object({})), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const user = await sessionUser(req);
    if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
    const result = await db.transaction(async (tx): Promise<TxOutcome> => {
      const [existing] = await tx.select().from(incidentReportsTable).where(eq(incidentReportsTable.id, id)).for("update");
      if (!existing) return { status: 404, error: "Report not found" } as const;
      const refusal = incidentSignRefusal(existing);
      if (refusal) return refusal;
      const now = new Date();
      const version = (existing.signedVersion ?? 0) + 1;
      const [row] = await tx
        .update(incidentReportsTable)
        .set({
          signedByUserId: user.id, signedByName: user.name, signedAt: now, signedVersion: version,
          unlockedAt: null, unlockedByUserId: null, unlockedByName: null, unlockReason: null,
          updatedAt: now,
        })
        .where(eq(incidentReportsTable.id, id))
        .returning();
      await tx.insert(incidentReportHistoryTable).values({
        incidentId: id, event: "signed", version, snapshot: snapshotIncident(row),
        actorUserId: user.id, actorName: user.name, createdAt: now,
      });
      return { row };
    });
    if ("error" in result) { res.status(result.status).json({ error: result.error }); return; }
    res.json(result.row);
  } catch (err) {
    console.error("[incidents] sign failed:", err);
    res.status(500).json({ error: "Failed to sign" });
  }
});

// POST /:id/unlock — a manager/admin (the whole router is behind that
// guard) opens a signed report for updating, with a short reason. The
// signed version stays on record as a snapshot; the report shows "needs
// signing again" until it is re-signed.
router.post("/:id/unlock", requireManagerOrAdmin, validate(z.object({ reason: z.string().trim().min(1).max(500) })), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const user = await sessionUser(req);
    if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
    const reason = (req.body as { reason: string }).reason.trim();
    const result = await db.transaction(async (tx): Promise<TxOutcome> => {
      const [existing] = await tx.select().from(incidentReportsTable).where(eq(incidentReportsTable.id, id)).for("update");
      if (!existing) return { status: 404, error: "Report not found" } as const;
      const refusal = incidentUnlockRefusal(existing, reason);
      if (refusal) return refusal;
      const version = Math.max(existing.signedVersion ?? 0, 1);
      const snapshot = snapshotIncident(existing);
      // Belt and braces: the version being unlocked must be on record
      // (0190 backfills signed reports; this covers anything it missed).
      const [hasSigned] = await tx
        .select({ id: incidentReportHistoryTable.id })
        .from(incidentReportHistoryTable)
        .where(and(
          eq(incidentReportHistoryTable.incidentId, id),
          eq(incidentReportHistoryTable.event, "signed"),
          eq(incidentReportHistoryTable.version, version),
        ));
      if (!hasSigned) {
        await tx.insert(incidentReportHistoryTable).values({
          incidentId: id, event: "signed", version, snapshot,
          actorUserId: existing.signedByUserId, actorName: existing.signedByName,
          createdAt: existing.signedAt ?? new Date(),
        });
      }
      const now = new Date();
      await tx.insert(incidentReportHistoryTable).values({
        incidentId: id, event: "unlocked", version, snapshot,
        actorUserId: user.id, actorName: user.name, reason, createdAt: now,
      });
      const [row] = await tx
        .update(incidentReportsTable)
        .set({ unlockedAt: now, unlockedByUserId: user.id, unlockedByName: user.name, unlockReason: reason, signedVersion: version, updatedAt: now })
        .where(eq(incidentReportsTable.id, id))
        .returning();
      return { row };
    });
    if ("error" in result) { res.status(result.status).json({ error: result.error }); return; }
    console.log(`[incidents] report ${id} unlocked by ${user.name} (${user.id}): ${reason}`);
    res.json(result.row);
  } catch (err) {
    console.error("[incidents] unlock failed:", err);
    res.status(500).json({ error: "Failed to unlock" });
  }
});

// GET /:id/history — signed versions and unlocks, oldest first, each
// signed version after the first carrying what changed since the last.
router.get("/:id/history", requireManagerOrAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const rows = await db
      .select()
      .from(incidentReportHistoryTable)
      .where(eq(incidentReportHistoryTable.incidentId, id))
      .orderBy(asc(incidentReportHistoryTable.createdAt), asc(incidentReportHistoryTable.id));
    res.json(buildIncidentHistory(rows));
  } catch (err) {
    console.error("[incidents] history failed:", err);
    res.status(500).json({ error: "Failed to load the history" });
  }
});

// POST /:id/close — mark resolved (and reopen with { reopen: true }).
router.post("/:id/close", requireManagerOrAdmin, validate(z.object({ reopen: z.boolean().optional() })), async (req: Request, res: Response) => {
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
    const existing = await accessibleReport(req, res, id);
    if (!existing) return;
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
    if (!(await accessibleReport(req, res, id))) return;
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
      const report = await accessibleReport(req, res, id);
      if (!report) return;
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
      // A photo while the batch or use-by is still blank: try reading it as
      // a pack label (Graeme, 27 Nov 2026) and fill ONLY the blank ones —
      // never overwrite what someone typed, and never a locked (signed)
      // report. A photo of the bone itself just reads nothing.
      let labelRead: { batchCode: string | null; useBy: string | null; saved: boolean } | null = null;
      if (row?.kind === EMAIL_PHOTO_KIND && (!report.productBatchCode || !report.productUseBy)) {
        const read = await readPackLabel(req.file.buffer, req.file.mimetype, "incidents");
        const batchCode = !report.productBatchCode ? read?.batchCode ?? null : null;
        const useBy = !report.productUseBy ? read?.useBy ?? null : null;
        if (batchCode || useBy) {
          const editable = !report.signedAt || !!report.unlockedAt;
          if (editable) {
            await db.update(incidentReportsTable)
              .set({ ...(batchCode ? { productBatchCode: batchCode } : {}), ...(useBy ? { productUseBy: useBy } : {}), updatedAt: new Date() })
              .where(and(eq(incidentReportsTable.id, id), sql`(${incidentReportsTable.signedAt} IS NULL OR ${incidentReportsTable.unlockedAt} IS NOT NULL)`));
          }
          labelRead = { batchCode, useBy, saved: editable };
          console.log(`[incidents] report ${id}: label photo read — batch ${batchCode ?? "-"}, use-by ${useBy ?? "-"}${editable ? "" : " (report locked, not saved)"}`);
        }
      }
      res.status(201).json({ ...row, labelRead });
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
      .select({ mime: incidentAttachmentsTable.mime, data: incidentAttachmentsTable.data, kind: incidentAttachmentsTable.kind, incidentId: incidentAttachmentsTable.incidentId })
      .from(incidentAttachmentsTable)
      .where(eq(incidentAttachmentsTable.id, attId));
    if (!row || !row.data) { res.status(404).json({ error: "Not found" }); return; }
    if (!(await accessibleReport(req, res, row.incidentId))) return;
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

// ── Email to the supplier (Graeme, 2026-11-19) ────────────────────────────
// Draft first (AI, or a plain version without it), shown on screen to edit,
// then one Send. Nothing goes until a person presses Send. The email goes
// to the supplier's account manager (else their main email), copied to the
// founder only (not accounts — 27 Nov 2026), with the report's photos attached, and
// is recorded on the report word for word. Off outside production.

const MAX_ATTACH_BYTES = 20 * 1024 * 1024;

router.post("/:id/supplier-email/draft", validate(z.object({})), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const user = await sessionUser(req);
    if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
    const report = await accessibleReport(req, res, id);
    if (!report) return;
    if (report.supplierId == null) { res.status(400).json({ error: "Choose the supplier first." }); return; }
    const [supplier] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, report.supplierId));
    if (!supplier) { res.status(400).json({ error: "That supplier no longer exists." }); return; }
    const [ingredient] = report.ingredientId != null
      ? await db.select({ name: ingredientsTable.name, code: ingredientsTable.supplierPartNumber }).from(ingredientsTable).where(eq(ingredientsTable.id, report.ingredientId))
      : [];
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(incidentAttachmentsTable)
      .where(and(eq(incidentAttachmentsTable.incidentId, id), isNull(incidentAttachmentsTable.deletedAt), eq(incidentAttachmentsTable.kind, EMAIL_PHOTO_KIND)));
    const emailTo = supplier.accountManagerEmail?.trim() || supplier.email?.trim() || "";
    const recipientName = supplier.accountManagerEmail?.trim() ? supplier.accountManagerName : supplier.contactName;
    const fmt = (d: Date | string) => new Date(d).toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" });
    const draft = await draftSupplierEmail({
      supplierName: supplier.name,
      recipientName: recipientName ?? null,
      accountNumber: supplier.accountNumber ?? null,
      productName: ingredient?.name ?? null,
      supplierCode: ingredient?.code ?? null,
      batchCode: report.productBatchCode,
      useBy: report.productUseBy ? fmt(report.productUseBy) : null,
      occurredOn: fmt(report.occurredAt),
      title: report.title || "Problem with a delivered product",
      description: report.description,
      foodSafetyImpact: report.foodSafetyImpact,
      photoCount: Number(n),
      senderName: user.name,
    });
    // replyTo: where the supplier's answer lands — shown under the draft so
    // nobody has to wonder (Graeme, 27 Nov 2026). Same value the send uses.
    res.json({ to: emailTo, recipientName: recipientName ?? null, subject: draft.subject, body: draft.body, photoCount: Number(n), usedAi: draft.usedAi, replyTo: FOUNDER_EMAIL });
  } catch (err) {
    console.error("[incidents] supplier email draft failed:", err);
    res.status(500).json({ error: "Couldn't draft the email — try again." });
  }
});

router.post(
  "/:id/supplier-email/send",
  validate(z.object({
    to: z.string().trim().min(3).max(200),
    subject: z.string().trim().min(1).max(SUPPLIER_EMAIL_LIMITS.subject),
    body: z.string().trim().min(1).max(SUPPLIER_EMAIL_LIMITS.body),
  })),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    try {
      const user = await sessionUser(req);
      if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
      const report = await accessibleReport(req, res, id);
      if (!report) return;
      const { to, subject, body } = req.body as { to: string; subject: string; body: string };
      const refusal = supplierEmailSendRefusal(report, to);
      if (refusal) { res.status(409).json({ error: refusal }); return; }
      // Only a manager's consent sends it (Graeme, 19 Nov 2026); anyone else
      // asks through /supplier-email/request.
      if (supplierEmailStep(await resolveRole(req), report) !== "send") {
        res.status(403).json({ error: "Only a manager can send this to the supplier — ask a manager to approve it." });
        return;
      }

      if (shouldSkipSideEffect()) {
        console.log(`[incidents] supplier email for report ${id} skipped (side effects off) — would go to ${to}`);
        res.status(409).json({ error: "Emails are switched off on this test copy of the planner — nothing was sent." });
        return;
      }

      const photos = await db
        .select({ id: incidentAttachmentsTable.id, mime: incidentAttachmentsTable.mime, data: incidentAttachmentsTable.data, sizeBytes: incidentAttachmentsTable.sizeBytes })
        .from(incidentAttachmentsTable)
        .where(and(eq(incidentAttachmentsTable.incidentId, id), isNull(incidentAttachmentsTable.deletedAt), eq(incidentAttachmentsTable.kind, EMAIL_PHOTO_KIND)))
        .orderBy(asc(incidentAttachmentsTable.id));
      let total = 0;
      const attach = photos.filter(p => p.data && (total += p.sizeBytes ?? 0) <= MAX_ATTACH_BYTES);

      // Claim the send first so a double tap can't email twice.
      const [claimed] = await db
        .update(incidentReportsTable)
        .set({ supplierEmailSentAt: new Date(), supplierEmailSentByName: user.name, supplierEmailTo: to, supplierEmailSubject: subject, supplierEmailBody: body, updatedAt: new Date() })
        .where(and(eq(incidentReportsTable.id, id), isNull(incidentReportsTable.supplierEmailSentAt)))
        .returning({ id: incidentReportsTable.id });
      if (!claimed) { res.status(409).json({ error: "The supplier has already been emailed about this report." }); return; }

      try {
        await sendEmail({
          to,
          cc: supplierEmailCc(to, FOUNDER_EMAIL),
          replyTo: FOUNDER_EMAIL,
          fromName: "The Calzone Kitchen",
          fromEmail: FROM_EMAIL,
          subject,
          text: body,
          html: plainTextToHtml(body),
          attachments: attach.map((p, i) => ({
            filename: `incident-${id}-photo-${i + 1}.${p.mime === "image/png" ? "png" : "jpg"}`,
            content: Buffer.from(p.data!).toString("base64"),
            contentType: p.mime,
          })),
        });
      } catch (sendErr) {
        // Not sent — release the claim so it can be tried again.
        await db.update(incidentReportsTable)
          .set({ supplierEmailSentAt: null, supplierEmailSentByName: null, supplierEmailTo: null, supplierEmailSubject: null, supplierEmailBody: null })
          .where(eq(incidentReportsTable.id, id));
        console.error(`[incidents] supplier email for report ${id} failed:`, sendErr);
        res.status(502).json({ error: "The email didn't send — try again in a minute." });
        return;
      }
      console.log(`[incidents] supplier email for report ${id} sent to ${to} by ${user.name} (${attach.length} photos)`);
      await closeApprovalTodos(id);
      const [row] = await db.select().from(incidentReportsTable).where(eq(incidentReportsTable.id, id));
      res.json(row);
    } catch (err) {
      console.error("[incidents] supplier email send failed:", err);
      res.status(500).json({ error: "The email didn't send — try again." });
    }
  },
);

// ─── Asking a manager to approve the supplier email (19 Nov 2026) ─────────
// Anyone who can see the report can draft the email; only a manager sends
// it. Asking keeps the draft on the report and gives every manager a to-do
// pointing at it. A manager then sends it (editing first if they like) or
// decides not to.

const approvalTitle = (id: number, title: string | null) => `Approve supplier email: ${title?.trim() || "incident report"} (report #${id})`;
const approvalTag = (id: number) => `%(report #${id})`;

async function closeApprovalTodos(id: number): Promise<void> {
  await db.execute(sql`
    UPDATE todo_tasks SET status = 'done', completed_at = NOW(), updated_at = NOW()
    WHERE status = 'open' AND created_by_name = 'Incident reports' AND title LIKE ${approvalTag(id)}
  `);
}

router.post(
  "/:id/supplier-email/request",
  validate(z.object({
    to: z.string().trim().min(3).max(200),
    subject: z.string().trim().min(1).max(SUPPLIER_EMAIL_LIMITS.subject),
    body: z.string().trim().min(1).max(SUPPLIER_EMAIL_LIMITS.body),
  })),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    try {
      const user = await sessionUser(req);
      if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
      const report = await accessibleReport(req, res, id);
      if (!report) return;
      const { to, subject, body } = req.body as { to: string; subject: string; body: string };
      const refusal = supplierEmailSendRefusal(report, to);
      if (refusal) { res.status(409).json({ error: refusal }); return; }
      const [supplier] = report.supplierId != null
        ? await db.select({ name: suppliersTable.name }).from(suppliersTable).where(eq(suppliersTable.id, report.supplierId))
        : [];
      await db.update(incidentReportsTable)
        .set({ supplierEmailTo: to, supplierEmailSubject: subject, supplierEmailBody: body, supplierEmailRequestedAt: new Date(), supplierEmailRequestedByName: user.name, updatedAt: new Date() })
        .where(and(eq(incidentReportsTable.id, id), isNull(incidentReportsTable.supplierEmailSentAt)));
      const title = approvalTitle(id, report.title);
      await db.execute(sql`
        INSERT INTO todo_tasks (assignee_id, created_by, created_by_name, title, notes, url, priority, due_date, status)
        SELECT u.id, ${user.id}, 'Incident reports', ${title},
               ${`${user.name} has drafted an email to ${supplier?.name ?? "the supplier"} about this report and needs a manager's approval before it's sent. Read the report and the email, then send it (edit it first if you like) or decide not to.`},
               ${`/reports?tab=haccp&haccp=incidents&incident=${id}`}, 'high', ${londonDateString()}::date, 'open'
        FROM app_users u
        WHERE u.is_active = TRUE AND u.role IN ('manager', 'admin')
          AND NOT EXISTS (SELECT 1 FROM todo_tasks t WHERE t.assignee_id = u.id AND t.status = 'open' AND t.title = ${title})
      `);
      console.log(`[incidents] supplier email for report ${id} drafted by ${user.name} — waiting for a manager`);
      const [row] = await db.select().from(incidentReportsTable).where(eq(incidentReportsTable.id, id));
      res.json(row);
    } catch (err) {
      console.error("[incidents] supplier email request failed:", err);
      res.status(500).json({ error: "Couldn't ask a manager — try again." });
    }
  },
);

router.post("/:id/supplier-email/decline", requireManagerOrAdmin, validate(z.object({})), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const user = await sessionUser(req);
    await db.update(incidentReportsTable)
      .set({ supplierEmailRequestedAt: null, supplierEmailRequestedByName: null, updatedAt: new Date() })
      .where(and(eq(incidentReportsTable.id, id), isNull(incidentReportsTable.supplierEmailSentAt)));
    await closeApprovalTodos(id);
    console.log(`[incidents] supplier email for report ${id} not sent — decided by ${user?.name ?? "a manager"}`);
    const [row] = await db.select().from(incidentReportsTable).where(eq(incidentReportsTable.id, id));
    res.json(row);
  } catch (err) {
    console.error("[incidents] supplier email decline failed:", err);
    res.status(500).json({ error: "Couldn't save that — try again." });
  }
});

export default router;
