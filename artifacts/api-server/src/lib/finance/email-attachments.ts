// Which parts of a mailbox email count as attachments, and what they are —
// for previewing them on a suggestion before attaching one (Graeme,
// 2026-11-03). Pure, so it's unit-tested without a mailbox.

export interface EmailAttachmentInfo {
  /** Position in the email — what the preview and attach routes take. */
  index: number;
  filename: string;
  contentType: string;
  size: number;
  /** A PDF or a photo: something that can be shown and can be an invoice. */
  previewable: boolean;
}

/** PDFs mislabelled octet-stream by some senders are still PDFs. */
export function attachmentMime(contentType: string | undefined, filename: string | undefined): string {
  const name = (filename ?? "").toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (contentType && contentType !== "application/octet-stream") return contentType;
  if (/\.(jpe?g)$/.test(name)) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  return contentType || "application/octet-stream";
}

/** The attachments a person would call attachments: not the logos and
 *  spacer images embedded in the email's own HTML. */
export function listedAttachments(attachments: Array<{ filename?: string; contentType: string; size?: number; contentDisposition?: string; related?: boolean; cid?: string }>): EmailAttachmentInfo[] {
  return attachments
    .map((a, index) => ({ a, index }))
    .filter(({ a }) => {
      const mime = attachmentMime(a.contentType, a.filename);
      if (mime === "application/pdf") return true;
      return a.contentDisposition === "attachment" && !a.related;
    })
    .map(({ a, index }) => {
      const contentType = attachmentMime(a.contentType, a.filename);
      return {
        index,
        filename: a.filename || `attachment-${index + 1}`,
        contentType,
        size: a.size ?? 0,
        previewable: contentType === "application/pdf" || /^image\/(jpeg|png|webp|gif)$/.test(contentType),
      };
    });
}
