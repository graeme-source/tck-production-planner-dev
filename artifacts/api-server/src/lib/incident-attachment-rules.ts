/**
 * Rules for photos and videos on accident & incident reports (Graeme,
 * 2026-10-13: a foreign-object report needed its photo). Objective B: the
 * diary is HACCP evidence, so:
 *
 *  - anyone who can see the diary may add a photo, before or after the
 *    report is signed; one added after signing is marked as such forever
 *    (fixed at upload, from the report's signed_at at that moment);
 *  - removal is a soft delete by the uploader or a manager/admin, with the
 *    who/when/why kept on the row. Bytes are never thrown away;
 *  - a report with any attachment (even a removed one) can't be deleted.
 */

export const INCIDENT_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"] as const;
export const INCIDENT_VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime", "video/ogg"] as const;
export const INCIDENT_IMAGE_MAX_MB = 15;
export const INCIDENT_VIDEO_MAX_MB = 100;

export type IncidentMediaKind = "image" | "video";

/** "image" / "video" for an accepted MIME type, null for anything else. */
export function incidentMediaKind(mime: string | null | undefined): IncidentMediaKind | null {
  const m = (mime ?? "").toLowerCase();
  if ((INCIDENT_IMAGE_MIMES as readonly string[]).includes(m)) return "image";
  if ((INCIDENT_VIDEO_MIMES as readonly string[]).includes(m)) return "video";
  return null;
}

/** Plain-English reason an upload is refused, or null when it's fine. */
export function incidentUploadProblem(mime: string | null | undefined, sizeBytes: number): string | null {
  const kind = incidentMediaKind(mime);
  if (!kind) return "Photos and videos only (JPEG, PNG, WebP, HEIC, or MP4/MOV/WebM).";
  const maxMb = kind === "image" ? INCIDENT_IMAGE_MAX_MB : INCIDENT_VIDEO_MAX_MB;
  if (sizeBytes > maxMb * 1024 * 1024) {
    return kind === "image"
      ? `Photo too large (max ${maxMb}MB).`
      : `Video too large (max ${maxMb}MB) — record a shorter clip.`;
  }
  return null;
}

/** True when the report already carries a signature at upload time. */
export function isAddedAfterSigning(signedAt: Date | string | null | undefined): boolean {
  return signedAt != null && signedAt !== "";
}

export interface IncidentAttachmentDeleteContext {
  viewerUserId: number | null;
  viewerRole: string | null | undefined;
  uploadedByUserId: number | null;
  deletedAt: Date | string | null;
}

export type DeleteDecision = { ok: true } | { ok: false; status: 403 | 409; error: string };

/** The uploader or a manager/admin may remove an attachment that hasn't
 *  already been removed. Removal is always a soft delete. */
export function canRemoveIncidentAttachment(ctx: IncidentAttachmentDeleteContext): DeleteDecision {
  if (ctx.deletedAt) return { ok: false, status: 409, error: "Already removed." };
  if (ctx.viewerRole === "admin" || ctx.viewerRole === "manager") return { ok: true };
  if (ctx.viewerUserId != null && ctx.uploadedByUserId != null && ctx.viewerUserId === ctx.uploadedByUserId) {
    return { ok: true };
  }
  return { ok: false, status: 403, error: "Only the person who added it, or a manager, can remove this." };
}

/** A report may be deleted only while unsigned AND with no attachment
 *  rows at all — removed ones count, because their bytes are evidence. */
export function canDeleteIncidentReport(signedAt: Date | string | null, attachmentRows: number): { ok: true } | { ok: false; error: string } {
  if (signedAt) return { ok: false, error: "Signed reports can't be deleted — the diary is the record." };
  if (attachmentRows > 0) {
    return { ok: false, error: "This report has photos on it, so it's part of the record — close it instead of deleting it." };
  }
  return { ok: true };
}
