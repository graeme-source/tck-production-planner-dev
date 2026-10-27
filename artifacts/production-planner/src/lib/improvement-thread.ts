/**
 * Comments & photos on an improvement — the words on the card's button
 * (Graeme, 27 Oct 2026; Objective E): "we can see visually if there's a
 * comment or a link on there". The timeline itself is put together on the
 * server (api-server lib/improvement-thread.ts).
 */

export interface ThreadCounts {
  commentCount?: number | null;
  commentPhotoCount?: number | null;
}

const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** Is there anything in the conversation yet? */
export function hasThread(c: ThreadCounts): boolean {
  return n(c.commentCount) + n(c.commentPhotoCount) > 0;
}

/** The counts as the button shows them: "💬 3 · 📷 2", "💬 1", "📷 2" — or
 *  null when there's nothing yet (the button says "Add a comment"). */
export function threadCountsLabel(c: ThreadCounts): string | null {
  const parts: string[] = [];
  if (n(c.commentCount) > 0) parts.push(`💬 ${n(c.commentCount)}`);
  if (n(c.commentPhotoCount) > 0) parts.push(`📷 ${n(c.commentPhotoCount)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The same, in words, for screen readers. */
export function threadCountsSpoken(c: ThreadCounts): string {
  const comments = n(c.commentCount);
  const photos = n(c.commentPhotoCount);
  if (comments + photos === 0) return "No comments yet — add a comment";
  const parts: string[] = [];
  if (comments > 0) parts.push(`${comments} comment${comments === 1 ? "" : "s"}`);
  if (photos > 0) parts.push(`${photos} photo${photos === 1 ? "" : "s"}`);
  return `Comments & photos: ${parts.join(" and ")}`;
}

/** The send button's visible state while a comment goes up. */
export type SendState = "idle" | "sending" | "sent" | "failed";

export function sendStateLabel(state: SendState): string {
  switch (state) {
    case "sending": return "Sending…";
    case "sent": return "Sent ✓";
    case "failed": return "Couldn't send";
    default: return "Send";
  }
}
