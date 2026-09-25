/**
 * Who may see an uploaded (old, pre-app) contract — the pure rules, tested
 * (Graeme, 2026-09-25). Enforced in routes/uploaded-contracts.ts.
 *
 * An old contract carries pay, so it follows the contract rule, not the
 * People rule:
 *   • the HR-records accounts (middleware/hr-access.ts — the founder today,
 *     the finance director when they join) see, file, edit and remove them
 *     for anyone;
 *   • the employee sees THEIR OWN, read-only (Employee Hub → My Contract);
 *   • everyone else — including People-access users who aren't on the HR
 *     list, admins and managers — sees nothing, and a by-id request answers
 *     404, never 403, so a guesser can't learn the id exists.
 */

export interface UploadedContractViewer {
  viewerId: number | null | undefined;
  /** On the HR-records list (hasHrRecordAccess). */
  viewerIsHr: boolean;
  /** People access alone grants nothing here — carried only so the rule
   *  (and its test) can say so explicitly. */
  viewerHasPeopleAccess?: boolean;
}

export type UploadedContractAccess = "manage" | "own" | "none";

export function uploadedContractAccess(viewer: UploadedContractViewer, ownerId: number): UploadedContractAccess {
  if (viewer.viewerId == null) return "none";
  if (viewer.viewerIsHr) return "manage";
  if (viewer.viewerId === ownerId) return "own";
  return "none";
}

export function canSeeUploadedContract(viewer: UploadedContractViewer, ownerId: number): boolean {
  return uploadedContractAccess(viewer, ownerId) !== "none";
}

/** File a new one, edit its date/notes, remove it, read it with Claude. */
export function canManageUploadedContracts(viewer: UploadedContractViewer): boolean {
  return viewer.viewerId != null && viewer.viewerIsHr;
}

// ── Files ──────────────────────────────────────────────────────────────────

/** A PDF, or a photo of the paper copy. HEIC is left out on purpose: Claude
 *  can't read it, and the iPad camera hands the browser a JPEG anyway. */
export const UPLOADED_CONTRACT_MIMES: ReadonlySet<string> = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const UPLOADED_CONTRACT_MAX_MB = 15;

export function isAllowedContractFile(mime: string | null | undefined): boolean {
  return mime != null && UPLOADED_CONTRACT_MIMES.has(mime);
}

// Anthropic's limits: PDFs up to 32 MB (and 100 pages); images up to 5 MB.
const CLAUDE_MAX_PDF_BYTES = 32 * 1024 * 1024;
const CLAUDE_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Can this file be handed to Claude to read? The reason is shown to the
 *  founder as-is, so it says what to do. */
export function claudeCanRead(mime: string, bytes: number): { ok: true } | { ok: false; reason: string } {
  if (mime === "application/pdf") {
    return bytes <= CLAUDE_MAX_PDF_BYTES ? { ok: true } : { ok: false, reason: "That PDF is too big to read automatically — type the details in instead." };
  }
  if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp") {
    return bytes <= CLAUDE_MAX_IMAGE_BYTES
      ? { ok: true }
      : { ok: false, reason: "That photo is over 5 MB, too big to read automatically — type the details in, or upload a smaller photo or a PDF scan." };
  }
  return { ok: false, reason: "Only PDFs and photos can be read automatically — type the details in instead." };
}
