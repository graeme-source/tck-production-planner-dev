/**
 * Documents on a person's record (Graeme, 2026-09-25: "Is it possible for
 * me, on people's timelines, just to post a document that gets stored in
 * their document section?").
 *
 * The person themself (session only — no user parameter, and NOT behind the
 * People PIN, like /api/contracts/uploaded/mine):
 *   GET    /api/person-documents/mine               my shared documents (no notes)
 *   GET    /api/person-documents/mine/:id/file      one of them, inline (?download=1)
 *
 * The People side (People access + private PIN set and unlocked —
 * requirePeopleUnlock, then a People-access check):
 *   GET    /api/person-documents/person/:userId     one person's documents + their
 *                                                   own onboarding uploads
 *   POST   /api/person-documents/person/:userId     file one (multipart: file, kind,
 *                                                   title, documentDate, notes?,
 *                                                   sharedWithEmployee?, visibility?)
 *   GET    /api/person-documents/onboarding/:id/file  an onboarding upload (P45 etc.)
 *   GET    /api/person-documents/:id                one document
 *   GET    /api/person-documents/:id/file           the file, inline (?download=1)
 *   PATCH  /api/person-documents/:id                kind, title, date, notes, shared,
 *                                                   visibility (HR only) — autosaved
 *   DELETE /api/person-documents/:id                remove = soft delete (who + when)
 *
 * Every route re-checks visibility on the server (lib/person-document-rules.ts,
 * tested): founder-only ('hr') documents are left out of lists and answer
 * 404 by id for anyone not on the HR-records list; a document that isn't
 * yours answers 404, never 403; removed documents are gone everywhere.
 * Nothing is ever hard-deleted — the table refuses DELETE (migration 0132).
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import * as z from "zod";
import { db, personDocumentsTable, onboardingDocumentsTable, usersTable } from "@workspace/db";
import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { validate, validateQuery } from "../middleware/validate";
import { singleFileUpload } from "../middleware/upload";
import { hasHrRecordAccess } from "../middleware/hr-access";
import { requirePeopleUnlock } from "../middleware/people-unlock";
import { hasPeopleAccess } from "../lib/people-access";
import {
  PERSON_DOCUMENT_KINDS, PERSON_DOCUMENT_VISIBILITIES, PERSON_DOCUMENT_MAX_MB,
  personDocumentAccess, documentsForPeopleViewer, documentsForEmployee, shapeForEmployee,
  visibilityOnCreate, visibilityOnEdit, canSeeOnboardingDocument, onboardingDocumentVisibility,
  personDocumentFileProblem, titleFromFileName, safeDownloadName,
  type PersonDocViewer, type PersonDocumentVisibility,
} from "../lib/person-document-rules";

const router: IRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Everything except the bytes — those only leave through a /file route.
const META = {
  id: personDocumentsTable.id,
  userId: personDocumentsTable.userId,
  kind: personDocumentsTable.kind,
  title: personDocumentsTable.title,
  documentDate: personDocumentsTable.documentDate,
  notes: personDocumentsTable.notes,
  fileName: personDocumentsTable.fileName,
  mime: personDocumentsTable.mime,
  byteSize: personDocumentsTable.byteSize,
  visibility: personDocumentsTable.visibility,
  sharedWithEmployee: personDocumentsTable.sharedWithEmployee,
  uploadedByName: personDocumentsTable.uploadedByName,
  uploadedAt: personDocumentsTable.uploadedAt,
  updatedAt: personDocumentsTable.updatedAt,
  deletedAt: personDocumentsTable.deletedAt,
} as const;

type MetaRow = {
  id: number; userId: number; kind: string; title: string; documentDate: string; notes: string | null;
  fileName: string | null; mime: string; byteSize: number; visibility: string; sharedWithEmployee: boolean;
  uploadedByName: string | null; uploadedAt: Date; updatedAt: Date; deletedAt: Date | null;
};

/** The People-side view. */
function shapeForPeople(r: MetaRow) {
  return {
    id: r.id, userId: r.userId, kind: r.kind, title: r.title, documentDate: r.documentDate, notes: r.notes,
    fileName: r.fileName, mime: r.mime, byteSize: r.byteSize, visibility: r.visibility as PersonDocumentVisibility,
    sharedWithEmployee: r.sharedWithEmployee, uploadedByName: r.uploadedByName, uploadedAt: r.uploadedAt,
    updatedAt: r.updatedAt,
  };
}

function parseId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function fail(res: Response, where: string, err: unknown, message: string) {
  console.error(`[person-documents] ${where} failed:`, err instanceof Error ? err.message : err);
  res.status(500).json({ error: message });
}

async function viewerOf(req: Request): Promise<PersonDocViewer> {
  const viewerId = req.session.userId ?? null;
  const [peopleAccess, isHr] = await Promise.all([hasPeopleAccess(viewerId), hasHrRecordAccess(req)]);
  return { viewerId, hasPeopleAccess: peopleAccess, isHr };
}

async function myName(userId: number): Promise<string | null> {
  const [me] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  return me?.name ?? null;
}

function sendFile(res: Response, opts: { data: Buffer; mime: string; fileName: string | null; download: boolean }) {
  res.setHeader("Content-Type", opts.mime);
  res.setHeader("Content-Disposition", `${opts.download ? "attachment" : "inline"}; filename="${safeDownloadName(opts.fileName, opts.mime)}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Personnel files: never let a shared iPad's cache keep a copy.
  res.setHeader("Cache-Control", "private, no-store");
  res.send(opts.data);
}

const FileQuery = z.object({ download: z.enum(["0", "1"]).optional() });

// ── The person themself ────────────────────────────────────────────────────

// Takes NO user parameter: the session is the only selector.
router.get("/mine", async (req: Request, res: Response) => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const rows = await db.select(META).from(personDocumentsTable)
      .where(and(
        eq(personDocumentsTable.userId, userId),
        eq(personDocumentsTable.sharedWithEmployee, true),
        isNull(personDocumentsTable.deletedAt),
      ))
      .orderBy(desc(personDocumentsTable.documentDate), desc(personDocumentsTable.uploadedAt));
    res.json(documentsForEmployee(userId, rows as MetaRow[]).map(shapeForEmployee));
  } catch (err) {
    fail(res, "mine", err, "Couldn't load your documents");
  }
});

router.get("/mine/:id/file", validateQuery(FileQuery), async (req: Request, res: Response) => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = parseId(req.params["id"]);
  if (id == null) { res.status(404).json({ error: "No such document" }); return; }
  try {
    const [row] = await db.select({ ...META, data: personDocumentsTable.data }).from(personDocumentsTable)
      .where(eq(personDocumentsTable.id, id));
    // The employee route answers ONLY for "own" — even for the founder.
    const access = row
      ? personDocumentAccess({ viewerId: userId, hasPeopleAccess: false, isHr: false }, row)
      : "none";
    if (!row || access !== "own") { res.status(404).json({ error: "No such document" }); return; }
    const { download } = res.locals["query"] as z.infer<typeof FileQuery>;
    sendFile(res, { data: row.data, mime: row.mime, fileName: row.fileName, download: download === "1" });
  } catch (err) {
    fail(res, "mine file", err, "Couldn't open the document");
  }
});

// ── The People side: everything below needs People access ──────────────────

async function requirePeopleAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    // 404, not 403: nothing here exists for someone without People access.
    if (!(await hasPeopleAccess(userId))) { res.status(404).json({ error: "Not found" }); return; }
    next();
  } catch (err) {
    fail(res, "access check", err, "Internal server error");
  }
}
router.use(requirePeopleUnlock, requirePeopleAccess);

/** Load a document the viewer may manage, or answer 404 and return null. */
async function loadManaged(req: Request, res: Response) {
  const id = parseId(req.params["id"]);
  if (id == null) { res.status(404).json({ error: "No such document" }); return null; }
  const [row] = await db.select(META).from(personDocumentsTable).where(eq(personDocumentsTable.id, id));
  const viewer = await viewerOf(req);
  if (!row || personDocumentAccess(viewer, row) !== "manage") {
    res.status(404).json({ error: "No such document" });
    return null;
  }
  return { row: row as MetaRow, viewer };
}

// One person's documents, plus the files they uploaded themselves at onboarding.
router.get("/person/:userId", async (req: Request, res: Response) => {
  const userId = parseId(req.params["userId"]);
  if (userId == null) { res.status(400).json({ error: "Invalid person" }); return; }
  try {
    const [person] = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
    if (!person) { res.status(404).json({ error: "Not found" }); return; }
    const viewer = await viewerOf(req);
    const [docs, onboarding] = await Promise.all([
      db.select(META).from(personDocumentsTable)
        .where(and(eq(personDocumentsTable.userId, userId), isNull(personDocumentsTable.deletedAt)))
        .orderBy(desc(personDocumentsTable.documentDate), desc(personDocumentsTable.uploadedAt)),
      db.select({
        id: onboardingDocumentsTable.id,
        kind: onboardingDocumentsTable.kind,
        fileName: onboardingDocumentsTable.fileName,
        mime: onboardingDocumentsTable.fileMime,
        byteSize: onboardingDocumentsTable.fileSizeBytes,
        uploadedAt: onboardingDocumentsTable.uploadedAt,
      }).from(onboardingDocumentsTable)
        // Only uploads that actually hold a file — nothing to open otherwise.
        .where(and(eq(onboardingDocumentsTable.userId, userId), isNotNull(onboardingDocumentsTable.fileBlob)))
        .orderBy(asc(onboardingDocumentsTable.uploadedAt)),
    ]);
    res.json({
      person,
      canSetVisibility: viewer.isHr,
      documents: documentsForPeopleViewer(viewer, docs as MetaRow[]).map(shapeForPeople),
      onboarding: onboarding
        .filter(d => canSeeOnboardingDocument(viewer, d.kind))
        .map(d => ({
          id: d.id, kind: d.kind, fileName: d.fileName, mime: d.mime ?? "application/octet-stream",
          byteSize: d.byteSize ?? 0, uploadedAt: d.uploadedAt, uploadedByName: person.name,
          visibility: onboardingDocumentVisibility(d.kind),
        })),
    });
  } catch (err) {
    fail(res, "list", err, "Couldn't load documents");
  }
});

// Multipart text fields arrive as strings.
const boolField = z.union([z.literal("true"), z.literal("false"), z.boolean()]).optional();

const UploadFields = z.object({
  kind: z.enum(PERSON_DOCUMENT_KINDS),
  title: z.string().max(400).optional(),
  documentDate: z.string().regex(DATE_RE, "Date must be YYYY-MM-DD"),
  notes: z.string().max(4000).optional(),
  sharedWithEmployee: boolField,
  visibility: z.enum(PERSON_DOCUMENT_VISIBILITIES).optional(),
});

router.post(
  "/person/:userId",
  singleFileUpload("file", PERSON_DOCUMENT_MAX_MB),
  validate(UploadFields),
  async (req: Request, res: Response) => {
    const userId = parseId(req.params["userId"]);
    if (userId == null) { res.status(400).json({ error: "Invalid person" }); return; }
    const body = req.body as z.infer<typeof UploadFields>;
    if (!req.file) { res.status(400).json({ error: "Choose the document first." }); return; }
    const problem = personDocumentFileProblem({
      mime: req.file.mimetype, bytes: req.file.size, head: req.file.buffer.subarray(0, 16),
    });
    if (problem) { res.status(400).json({ error: problem }); return; }
    try {
      const [person] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId));
      if (!person) { res.status(400).json({ error: "No such person" }); return; }
      const viewer = await viewerOf(req);
      const title = (body.title ?? "").trim().slice(0, 200) || titleFromFileName(req.file.originalname) || "Document";
      const shared = body.sharedWithEmployee === true || body.sharedWithEmployee === "true";
      const me = req.session.userId!;
      const [row] = await db.insert(personDocumentsTable).values({
        userId,
        kind: body.kind,
        title,
        documentDate: body.documentDate,
        notes: body.notes?.trim() ? body.notes.trim() : null,
        fileName: req.file.originalname ? req.file.originalname.slice(0, 200) : null,
        mime: req.file.mimetype,
        byteSize: req.file.size,
        data: req.file.buffer,
        visibility: visibilityOnCreate({ kind: body.kind, requested: body.visibility, viewerIsHr: viewer.isHr }),
        sharedWithEmployee: shared,
        uploadedByUserId: me,
        uploadedByName: await myName(me),
        updatedByUserId: me,
      }).returning(META);
      const r = row as MetaRow;
      // A non-HR uploader filing a warning can't see it afterwards — say so
      // rather than hand back what they may no longer read.
      if (personDocumentAccess(viewer, r) !== "manage") {
        res.status(201).json({ id: r.id, filedFounderOnly: true });
        return;
      }
      res.status(201).json(shapeForPeople(r));
    } catch (err) {
      fail(res, "upload", err, "Couldn't file the document");
    }
  },
);

// An onboarding upload (P45, right to work…), People-gated here; the P45 is
// founder-only. The owner still reads their own through /api/onboarding.
router.get("/onboarding/:id/file", validateQuery(FileQuery), async (req: Request, res: Response) => {
  const id = parseId(req.params["id"]);
  if (id == null) { res.status(404).json({ error: "No such document" }); return; }
  try {
    const [row] = await db.select().from(onboardingDocumentsTable).where(eq(onboardingDocumentsTable.id, id));
    const viewer = await viewerOf(req);
    if (!row || !row.fileBlob || !canSeeOnboardingDocument(viewer, row.kind)) {
      res.status(404).json({ error: "No such document" });
      return;
    }
    const { download } = res.locals["query"] as z.infer<typeof FileQuery>;
    const data = Buffer.isBuffer(row.fileBlob) ? row.fileBlob : Buffer.from(row.fileBlob as Uint8Array);
    sendFile(res, { data, mime: row.fileMime || "application/octet-stream", fileName: row.fileName, download: download === "1" });
  } catch (err) {
    fail(res, "onboarding file", err, "Couldn't open the document");
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const found = await loadManaged(req, res);
    if (!found) return;
    res.json({ ...shapeForPeople(found.row), canSetVisibility: found.viewer.isHr });
  } catch (err) {
    fail(res, "read", err, "Couldn't open the document");
  }
});

router.get("/:id/file", validateQuery(FileQuery), async (req: Request, res: Response) => {
  try {
    const found = await loadManaged(req, res);
    if (!found) return;
    const [file] = await db.select({ data: personDocumentsTable.data }).from(personDocumentsTable)
      .where(eq(personDocumentsTable.id, found.row.id));
    if (!file) { res.status(404).json({ error: "No such document" }); return; }
    const { download } = res.locals["query"] as z.infer<typeof FileQuery>;
    sendFile(res, { data: file.data, mime: found.row.mime, fileName: found.row.fileName, download: download === "1" });
  } catch (err) {
    fail(res, "file", err, "Couldn't open the document");
  }
});

const PatchBody = z.object({
  kind: z.enum(PERSON_DOCUMENT_KINDS).optional(),
  // Generous cap: tidied and cut to 200, never refused mid-typing by autosave.
  title: z.string().max(800).optional(),
  documentDate: z.string().regex(DATE_RE, "Date must be YYYY-MM-DD").optional(),
  notes: z.string().max(4000).nullable().optional(),
  sharedWithEmployee: z.boolean().optional(),
  visibility: z.enum(PERSON_DOCUMENT_VISIBILITIES).optional(),
});

router.patch("/:id", validate(PatchBody), async (req: Request, res: Response) => {
  try {
    const found = await loadManaged(req, res);
    if (!found) return;
    const body = req.body as z.infer<typeof PatchBody>;
    const vis = visibilityOnEdit({
      current: found.row.visibility as PersonDocumentVisibility,
      currentKind: found.row.kind,
      newKind: body.kind,
      requested: body.visibility,
      viewerIsHr: found.viewer.isHr,
    });
    if (!vis.ok) { res.status(403).json({ error: vis.error }); return; }
    const title = body.title !== undefined ? body.title.trim().slice(0, 200) : undefined;
    if (title === "") { res.status(400).json({ error: "A document needs a title." }); return; }
    const [row] = await db.update(personDocumentsTable).set({
      ...(body.kind !== undefined ? { kind: body.kind } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(body.documentDate !== undefined ? { documentDate: body.documentDate } : {}),
      ...(body.notes !== undefined ? { notes: body.notes == null || body.notes.trim() === "" ? null : body.notes.trim() } : {}),
      ...(body.sharedWithEmployee !== undefined ? { sharedWithEmployee: body.sharedWithEmployee } : {}),
      visibility: vis.visibility,
      updatedByUserId: req.session.userId ?? null,
      updatedAt: new Date(),
    }).where(and(eq(personDocumentsTable.id, found.row.id), isNull(personDocumentsTable.deletedAt))).returning(META);
    if (!row) { res.status(404).json({ error: "No such document" }); return; }
    const r = row as MetaRow;
    if (personDocumentAccess(found.viewer, r) !== "manage") {
      res.json({ id: r.id, filedFounderOnly: true });
      return;
    }
    res.json({ ...shapeForPeople(r), canSetVisibility: found.viewer.isHr });
  } catch (err) {
    fail(res, "save", err, "Couldn't save the change");
  }
});

// "Remove" — a soft delete, with who and when. Never a hard delete.
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const found = await loadManaged(req, res);
    if (!found) return;
    const me = req.session.userId!;
    await db.update(personDocumentsTable).set({
      deletedAt: new Date(),
      deletedByUserId: me,
      deletedByName: await myName(me),
    }).where(and(eq(personDocumentsTable.id, found.row.id), isNull(personDocumentsTable.deletedAt)));
    res.json({ ok: true });
  } catch (err) {
    fail(res, "remove", err, "Couldn't remove the document");
  }
});

export default router;
