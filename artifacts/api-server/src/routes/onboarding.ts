// New-starter onboarding — pre-arrival info a colleague provides after accepting
// their invite. Every route here acts on the logged-in user's OWN record; other
// people's answers and files are People-record data (routes/person-documents.ts). Files (right-to-work / food
// hygiene) are stored inline as bytea, mirroring the documents repository.

import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { db, usersTable, onboardingSubmissionsTable, onboardingDocumentsTable, staffEmergencyContactsTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { tickPreArrivalDetails, starterGateStatus } from "../lib/starter-paperwork";

const router: IRouter = Router();

// pdf / jpg / png, capped at 15MB (same cap as the documents repository).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const DOC_KINDS = ["right_to_work", "food_hygiene", "p45", "other"] as const;

const docMetaColumns = {
  id: onboardingDocumentsTable.id,
  userId: onboardingDocumentsTable.userId,
  kind: onboardingDocumentsTable.kind,
  fileName: onboardingDocumentsTable.fileName,
  fileMime: onboardingDocumentsTable.fileMime,
  fileSizeBytes: onboardingDocumentsTable.fileSizeBytes,
  uploadedAt: onboardingDocumentsTable.uploadedAt,
} as const;

async function loadOnboarding(userId: number) {
  const [submission] = await db.select().from(onboardingSubmissionsTable).where(eq(onboardingSubmissionsTable.userId, userId));
  const documents = await db.select(docMetaColumns).from(onboardingDocumentsTable)
    .where(eq(onboardingDocumentsTable.userId, userId))
    .orderBy(asc(onboardingDocumentsTable.uploadedAt));
  return { submission: submission ?? null, documents };
}

// ─── Self (the logged-in user's own record) ──────────────────────────────────

// GET /me — current user's submission + document metadata (no blobs).
router.get("/me", async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    res.json(await loadOnboarding(userId));
  } catch (err) {
    console.error("[onboarding] get me failed:", err);
    res.status(500).json({ error: "Failed to load onboarding" });
  }
});

// GET /me/gate — what the first-login gate still wants from this person.
router.get("/me/gate", async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    res.json(await starterGateStatus(userId));
  } catch (err) {
    console.error("[onboarding] gate status failed:", err);
    res.status(500).json({ error: "Failed to load onboarding status" });
  }
});

// PUT /me — upsert text fields and mark the details step done.
router.put("/me", async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const str = (v: unknown) => (v != null && String(v).trim() ? String(v).trim() : null);
    const values = {
      phone: str(req.body?.phone),
      address: str(req.body?.address),
      emergencyContactName: str(req.body?.emergencyContactName),
      emergencyContactPhone: str(req.body?.emergencyContactPhone),
      emergencyContactRelationship: str(req.body?.emergencyContactRelationship),
      shoeSize: str(req.body?.shoeSize),
      // Two-way choice, validated to the two real options so the summary
      // managers order footwear from can't hold free text.
      footwearChoice: ["crocs", "safety_shoes"].includes(String(req.body?.footwearChoice)) ? String(req.body?.footwearChoice) : null,
    };

    // Emergency contact details are the point of this form — a blank submit
    // used to tick the step anyway (Graeme, 2026-09-07). Enforced HERE, not
    // just in the UI. Documents stay optional.
    const missing: string[] = [];
    if (!values.phone) missing.push("your mobile number");
    if (!values.address) missing.push("your home address");
    if (!values.emergencyContactName) missing.push("emergency contact name");
    if (!values.emergencyContactPhone) missing.push("emergency contact phone");
    if (!values.emergencyContactRelationship) missing.push("emergency contact relationship");
    if (!values.shoeSize) missing.push("your shoe size");
    if (!values.footwearChoice) missing.push("your footwear choice (Crocs or safety shoes)");
    if (missing.length > 0) {
      res.status(400).json({ error: `Still needed: ${missing.join(", ")}` });
      return;
    }

    await db
      .insert(onboardingSubmissionsTable)
      .values({ userId, ...values, submittedAt: new Date(), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: onboardingSubmissionsTable.userId,
        set: { ...values, submittedAt: new Date(), updatedAt: new Date() },
      });

    // The emergency contact is kept current in staff_emergency_contacts
    // (migration 0145) — the copy managers reach in an emergency and the
    // person updates later. Write it through so a new starter is never
    // asked twice; any second contact they've added there is kept.
    const contact = {
      name: values.emergencyContactName!,
      phone: values.emergencyContactPhone!,
      relationship: values.emergencyContactRelationship,
      source: "onboarding",
      updatedById: userId,
      updatedByName: null,
      updatedAt: new Date(),
    };
    await db.insert(staffEmergencyContactsTable)
      .values({ userId, ...contact })
      .onConflictDoUpdate({ target: staffEmergencyContactsTable.userId, set: contact });

    // Details alone don't finish onboarding: the gate also wants the starter
    // forms and contract signed, and even then it lifts only when the
    // founder grants access on the person's first day (Graeme, 2026-09-07).
    // The emergency-contact matrix column ticks itself here.
    tickPreArrivalDetails(userId).catch(err =>
      console.warn("[onboarding] pre-arrival tick failed:", err instanceof Error ? err.message : err));

    res.json(await loadOnboarding(userId));
  } catch (err) {
    console.error("[onboarding] save me failed:", err);
    res.status(500).json({ error: "Failed to save onboarding" });
  }
});

// POST /me/documents — upload one file (field "file", body "kind").
router.post("/me/documents", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
    const kind = DOC_KINDS.includes(req.body?.kind) ? req.body.kind : "other";

    const mime = req.file.mimetype || "application/octet-stream";
    const name = (req.file.originalname || "").toLowerCase();
    const allowed = ["application/pdf", "image/jpeg", "image/png", "application/octet-stream"].includes(mime)
      || /\.(pdf|jpe?g|png)$/.test(name);
    if (!allowed) { res.status(415).json({ error: `Unsupported file type: ${mime}. PDF, JPG or PNG only.` }); return; }

    const [row] = await db.insert(onboardingDocumentsTable).values({
      userId,
      kind,
      fileBlob: req.file.buffer,
      fileMime: mime === "application/octet-stream" ? "application/pdf" : mime,
      fileName: req.file.originalname || "document",
      fileSizeBytes: req.file.size,
      uploadedAt: new Date(),
    }).returning(docMetaColumns);
    res.status(201).json(row);
  } catch (err: any) {
    if (err?.code === "LIMIT_FILE_SIZE") { res.status(413).json({ error: "File too large (15MB max)" }); return; }
    console.error("[onboarding] upload failed:", err);
    res.status(500).json({ error: "Failed to upload document" });
  }
});

// DELETE /me/documents/:id — remove one of your own uploads.
router.delete("/me/documents/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const del = await db.delete(onboardingDocumentsTable)
      .where(and(eq(onboardingDocumentsTable.id, id), eq(onboardingDocumentsTable.userId, req.session.userId!)))
      .returning({ id: onboardingDocumentsTable.id });
    if (del.length === 0) { res.status(404).json({ error: "Document not found" }); return; }
    res.status(204).send();
  } catch (err) {
    console.error("[onboarding] delete document failed:", err);
    res.status(500).json({ error: "Failed to delete document" });
  }
});

// GET /documents/:id/file — stream YOUR OWN file. Anyone else's upload is
// read from their People record (/api/person-documents/onboarding/:id/file),
// behind People access + the private People PIN, with the P45 founder-only.
// This route used to let any manager or admin open anyone's — P45 included
// (closed 2026-09-28). 404, not 403: other people's files don't exist here.
router.get("/documents/:id/file", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db.select().from(onboardingDocumentsTable).where(eq(onboardingDocumentsTable.id, id));
    if (!row || !row.fileBlob || row.userId !== req.session.userId) { res.status(404).json({ error: "No file" }); return; }

    const buf = Buffer.isBuffer(row.fileBlob) ? row.fileBlob : Buffer.from(row.fileBlob as any);
    const filename = (row.fileName || "document").replace(/"/g, "");
    const disposition = req.query.download === "1" ? "attachment" : "inline";
    res.setHeader("Content-Type", row.fileMime || "application/octet-stream");
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Content-Disposition", `${disposition}; filename="${filename}"`);
    res.end(buf);
  } catch (err) {
    console.error("[onboarding] download failed:", err);
    res.status(500).json({ error: "Failed to download document" });
  }
});

// There is deliberately no "GET /:userId" any more. A colleague's onboarding
// form (address, phone, emergency contact) is part of their People record and
// is served only by /api/person-documents/person/:userId — People access +
// private PIN, decided per person by the founder, never by role
// (Graeme, 2026-09-28: "behind a gate").

export default router;
