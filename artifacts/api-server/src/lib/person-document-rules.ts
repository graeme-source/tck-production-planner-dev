/**
 * Documents on a person's record — the pure rules, tested (Graeme,
 * 2026-09-25: "on people's timelines, just to post a document that gets
 * stored in their document section"). Enforced in routes/person-documents.ts.
 *
 * Who sees a filed document:
 *   • visibility 'people' → anyone with People access (lib/people-access.ts);
 *   • visibility 'hr'     → the HR-records accounts only (middleware/hr-access.ts
 *                           — the founder today). A People-access user who
 *                           isn't on that list never sees it: omitted from
 *                           lists, 404 by id;
 *   • the person themself → only documents marked shared_with_employee,
 *                           read-only, never the notes;
 *   • anyone else          → nothing; a by-id request answers 404, never
 *                           403, so a guesser can't learn the id exists;
 *   • a removed (soft-deleted) document → nobody, anywhere.
 *
 * Defaults (the safe way round):
 *   • warning / disciplinary start as 'hr' (founder only); everything else
 *     starts as 'people'. Only an HR-records account may choose or change
 *     visibility; for anyone else it follows the kind.
 *   • shared_with_employee always starts false — sharing is an explicit tick,
 *     for every kind, warnings included.
 *
 * The person's own onboarding uploads (routes/onboarding.ts: P45, right to
 * work, food hygiene) show on the record read-only by the same rule, with
 * the P45 treated as 'hr' because it carries pay and tax to date.
 */

export const PERSON_DOCUMENT_KINDS = [
  "letter", "certificate", "right_to_work", "training_certificate", "warning", "disciplinary", "other",
] as const;
export type PersonDocumentKind = (typeof PERSON_DOCUMENT_KINDS)[number];

export const PERSON_DOCUMENT_VISIBILITIES = ["people", "hr"] as const;
export type PersonDocumentVisibility = (typeof PERSON_DOCUMENT_VISIBILITIES)[number];

/** Kinds that start founder-only. */
const HR_DEFAULT_KINDS: ReadonlySet<string> = new Set<PersonDocumentKind>(["warning", "disciplinary"]);

export function isPersonDocumentKind(k: unknown): k is PersonDocumentKind {
  return typeof k === "string" && (PERSON_DOCUMENT_KINDS as readonly string[]).includes(k);
}

export function isHrDefaultKind(kind: string): boolean {
  return HR_DEFAULT_KINDS.has(kind);
}

export function defaultVisibility(kind: string): PersonDocumentVisibility {
  return isHrDefaultKind(kind) ? "hr" : "people";
}

// ── Who sees what ──────────────────────────────────────────────────────────

export interface PersonDocViewer {
  viewerId: number | null | undefined;
  /** Has People access (and got through the private-PIN gate). */
  hasPeopleAccess: boolean;
  /** On the HR-records list (hasHrRecordAccess). */
  isHr: boolean;
}

export interface PersonDocFacts {
  userId: number;
  visibility: string;
  sharedWithEmployee: boolean;
  deletedAt: Date | string | null;
}

/** 'manage' = the People-side view (read, edit, remove); 'own' = the
 *  person's own read-only view; 'none' = answer 404. */
export type PersonDocAccess = "manage" | "own" | "none";

/** Can this viewer see a document of this visibility from the People side? */
export function canSeeVisibility(viewer: Pick<PersonDocViewer, "hasPeopleAccess" | "isHr">, visibility: string): boolean {
  if (visibility === "people") return viewer.hasPeopleAccess || viewer.isHr;
  if (visibility === "hr") return viewer.isHr;
  return false; // an unknown value is nobody's
}

export function personDocumentAccess(viewer: PersonDocViewer, doc: PersonDocFacts): PersonDocAccess {
  if (viewer.viewerId == null) return "none";
  if (doc.deletedAt != null) return "none";
  // The People side needs People access itself — HR alone isn't a way
  // around the People gate (the founder has both).
  if (viewer.hasPeopleAccess && canSeeVisibility(viewer, doc.visibility)) return "manage";
  if (viewer.viewerId === doc.userId && doc.sharedWithEmployee) return "own";
  return "none";
}

/** A person's documents as the People side should list them: live ones this
 *  viewer may see. Everything else is simply left out. */
export function documentsForPeopleViewer<T extends PersonDocFacts>(viewer: PersonDocViewer, docs: readonly T[]): T[] {
  return docs.filter(d => personDocumentAccess(viewer, d) === "manage");
}

/** The Employee Hub list: only the viewer's own, live, shared documents. */
export function documentsForEmployee<T extends PersonDocFacts>(viewerId: number | null | undefined, docs: readonly T[]): T[] {
  if (viewerId == null) return [];
  return docs.filter(d => d.userId === viewerId && d.deletedAt == null && d.sharedWithEmployee);
}

/** What the person themself gets: the document, never the notes, the
 *  visibility setting or the audit fields. */
export function shapeForEmployee<T extends {
  id: number; kind: string; title: string; documentDate: string; fileName: string | null;
  mime: string; byteSize: number; uploadedAt: Date | string;
}>(d: T) {
  return {
    id: d.id, kind: d.kind, title: d.title, documentDate: d.documentDate, fileName: d.fileName,
    mime: d.mime, byteSize: d.byteSize, uploadedAt: d.uploadedAt,
  };
}

// ── Choosing visibility ────────────────────────────────────────────────────

/** Visibility for a new document. Only HR may choose; everyone else gets the
 *  kind's default. */
export function visibilityOnCreate(input: {
  kind: string; requested: PersonDocumentVisibility | null | undefined; viewerIsHr: boolean;
}): PersonDocumentVisibility {
  if (input.viewerIsHr && input.requested) return input.requested;
  return defaultVisibility(input.kind);
}

export type VisibilityChange =
  | { ok: true; visibility: PersonDocumentVisibility }
  | { ok: false; error: string };

/** Visibility after an edit. Asking to change it is HR-only. Moving a
 *  document INTO warning/disciplinary makes it founder-only unless HR says
 *  otherwise in the same edit; moving it out never loosens it by itself. */
export function visibilityOnEdit(input: {
  current: PersonDocumentVisibility;
  currentKind: string;
  newKind: string | undefined;
  requested: PersonDocumentVisibility | undefined;
  viewerIsHr: boolean;
}): VisibilityChange {
  if (input.requested !== undefined && input.requested !== input.current && !input.viewerIsHr) {
    return { ok: false, error: "Only Graeme can change who sees a document." };
  }
  if (input.viewerIsHr && input.requested !== undefined) return { ok: true, visibility: input.requested };
  const kindChanged = input.newKind !== undefined && input.newKind !== input.currentKind;
  if (kindChanged && isHrDefaultKind(input.newKind!)) return { ok: true, visibility: "hr" };
  return { ok: true, visibility: input.current };
}

// ── Onboarding uploads on the record ───────────────────────────────────────

/** A starter's own uploads shown on their record: the P45 carries pay and
 *  tax to date, so it follows the contract rule (founder only). */
export function onboardingDocumentVisibility(kind: string): PersonDocumentVisibility {
  return kind === "p45" ? "hr" : "people";
}

/** People-side read of an onboarding upload. The employee reads their own
 *  through the onboarding routes, not here. */
export function canSeeOnboardingDocument(viewer: PersonDocViewer, kind: string): boolean {
  return viewer.viewerId != null && viewer.hasPeopleAccess && canSeeVisibility(viewer, onboardingDocumentVisibility(kind));
}

// ── Files ──────────────────────────────────────────────────────────────────

export const PERSON_DOCUMENT_MAX_MB = 15;

/** A PDF, or a photo of the paper copy. HEIC is allowed for iPhone photos
 *  shared across; the iPad camera itself hands the browser a JPEG. */
export const PERSON_DOCUMENT_MIMES: ReadonlySet<string> = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
]);

/** Does the start of the file look like what it says it is? Stops, say, an
 *  HTML page being filed as a "PDF" and served back to someone's browser. */
export function contentMatchesMime(mime: string, head: Uint8Array): boolean {
  const at = (i: number) => head[i];
  const ascii = (from: number, len: number) => String.fromCharCode(...Array.from(head.slice(from, from + len)));
  switch (mime) {
    case "application/pdf": return ascii(0, 5) === "%PDF-";
    case "image/jpeg": return at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff;
    case "image/png": return at(0) === 0x89 && ascii(1, 3) === "PNG";
    case "image/heic":
    case "image/heif": {
      if (ascii(4, 4) !== "ftyp") return false;
      return ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(ascii(8, 4));
    }
    default: return false;
  }
}

/** Why this file can't be filed, in words to show the person — or null. */
export function personDocumentFileProblem(file: { mime: string | null | undefined; bytes: number; head: Uint8Array }): string | null {
  if (!file.mime || !PERSON_DOCUMENT_MIMES.has(file.mime)) {
    return "PDFs and photos only (PDF, JPEG, PNG or HEIC).";
  }
  if (file.bytes <= 0) return "That file is empty — choose it again.";
  if (file.bytes > PERSON_DOCUMENT_MAX_MB * 1024 * 1024) {
    return `That file is over ${PERSON_DOCUMENT_MAX_MB} MB — scan it at a lower quality or photograph it instead.`;
  }
  if (!contentMatchesMime(file.mime, file.head)) {
    return "That file doesn't look like the PDF or photo it says it is — open it on the device, save it again, and retry.";
  }
  return null;
}

/** "Right_to_work-scan.2024.pdf" → "Right to work scan.2024". */
export function titleFromFileName(name: string | null | undefined, max = 200): string {
  const base = (name ?? "").replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return base.slice(0, max);
}

/** A safe name for Content-Disposition. */
export function safeDownloadName(name: string | null | undefined, mime: string, fallback = "document"): string {
  const ext = mime === "application/pdf" ? "pdf" : (mime.split("/")[1] ?? "bin");
  const raw = name && name.trim() ? name.trim() : `${fallback}.${ext}`;
  return raw.replace(/[^\w.\- ]+/g, "_").slice(0, 200);
}
