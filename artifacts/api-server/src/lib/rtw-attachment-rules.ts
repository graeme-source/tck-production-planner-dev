/**
 * Who may add or remove documentation (fit notes, appointment letters) on a
 * return-to-work form. Mirrors the form's own editing rule: a draft belongs
 * to the colleague and the named RTW managers together; once signed it is a
 * record, and only the RTW managers (Graeme and Lorna) may still file or
 * remove documents — the same people who can amend the form's text.
 */

export interface RtwAttachmentContext {
  formStatus: string;
  isRtwManager: boolean;
}

export function canUploadRtwAttachment(ctx: RtwAttachmentContext): boolean {
  if (ctx.isRtwManager) return true;
  return ctx.formStatus !== "complete";
}

/** Managers can always tidy; the colleague can remove only what THEY
 *  uploaded, and only while the form is still a draft. */
export function canDeleteRtwAttachment(ctx: RtwAttachmentContext & {
  uploadedByUserId: number | null;
  viewerUserId: number;
}): boolean {
  if (ctx.isRtwManager) return true;
  if (ctx.formStatus === "complete") return false;
  return ctx.uploadedByUserId != null && ctx.uploadedByUserId === ctx.viewerUserId;
}
