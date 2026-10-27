/**
 * Comments & photos on an improvement — the timeline behind every card
 * (Graeme, 27 Oct 2026; Objective E): "make it so I can comment on
 * improvements and also post photos, like a bit of a timeline … Someone's
 * asked for something that's already possible, and I just want to reply
 * to them."
 *
 * Pure: the route reads the rows and writes what these return.
 *
 *  - buildImprovementThread — the timeline, oldest first: the original
 *    submission at the top, then comments (each with any photos posted
 *    with it) and the "done" moment, in time order.
 *  - commentRecipients — who hears about a new comment.
 *  - commentNotification — the words on the bell and the push.
 *  - canDeleteComment — the comment's author, or a manager/admin.
 */

export interface ThreadPhoto {
  id: number;
  kind: "image" | "video";
}

export type ThreadEntry =
  | {
      type: "submitted";
      key: string;
      at: string;
      userName: string | null;
      title: string;
      description: string | null;
      /** The improvement's own before photos (or every one, when it isn't done yet). */
      photos: ThreadPhoto[];
    }
  | {
      type: "done";
      key: string;
      at: string;
      /** Everyone credited, already joined — "Graeme & Bodan". */
      names: string | null;
      /** The after photos. */
      photos: ThreadPhoto[];
    }
  | {
      type: "comment";
      key: string;
      at: string;
      id: number;
      userId: number | null;
      userName: string | null;
      text: string;
      photos: ThreadPhoto[];
      canDelete: boolean;
    };

export interface ThreadInput {
  improvement: {
    createdAt: Date | string;
    doneAt: Date | string | null;
    submittedByName: string | null;
    creditNames: string | null;
    title: string;
    description: string | null;
  };
  comments: ReadonlyArray<{
    id: number;
    userId: number | null;
    userName: string | null;
    comment: string;
    createdAt: Date | string;
  }>;
  /** Every attachment on the improvement — its own evidence and the
   *  conversation's photos (comment_id set). */
  attachments: ReadonlyArray<{
    id: number;
    commentId: number | null;
    kind: string;
    phase: string | null;
  }>;
  viewer: { userId: number | null; role: string | null | undefined };
}

const iso = (d: Date | string): string => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());
const toPhoto = (a: { id: number; kind: string }): ThreadPhoto => ({ id: a.id, kind: a.kind === "video" ? "video" : "image" });

/** The author, or a manager/admin tidying up a mistake. */
export function canDeleteComment(
  viewer: { userId: number | null; role: string | null | undefined },
  authorId: number | null,
): boolean {
  if (viewer.role === "admin" || viewer.role === "manager") return true;
  return viewer.userId != null && authorId != null && viewer.userId === authorId;
}

const ORDER: Record<ThreadEntry["type"], number> = { submitted: 0, done: 1, comment: 2 };

export function buildImprovementThread(input: ThreadInput): ThreadEntry[] {
  const { improvement, comments, attachments, viewer } = input;
  const byId = (a: { id: number }, b: { id: number }) => a.id - b.id;

  // The improvement's own evidence: the joined clip is a copy of the two
  // halves, so it never appears in the timeline.
  const evidence = attachments.filter(a => a.commentId == null && a.phase !== "stitched").slice().sort(byId);
  const done = improvement.doneAt != null;
  const afterPhotos = done ? evidence.filter(a => a.phase === "after") : [];
  const submittedPhotos = done ? evidence.filter(a => a.phase !== "after") : evidence;

  const photosByComment = new Map<number, ThreadPhoto[]>();
  for (const a of attachments.slice().sort(byId)) {
    if (a.commentId == null) continue;
    const list = photosByComment.get(a.commentId) ?? [];
    list.push(toPhoto(a));
    photosByComment.set(a.commentId, list);
  }

  const submitted: ThreadEntry = {
    type: "submitted",
    key: "submitted",
    at: iso(improvement.createdAt),
    userName: improvement.submittedByName,
    title: improvement.title,
    description: improvement.description,
    photos: submittedPhotos.map(toPhoto),
  };

  const rest: ThreadEntry[] = [];
  if (done) {
    rest.push({
      type: "done",
      key: "done",
      at: iso(improvement.doneAt!),
      names: improvement.creditNames,
      photos: afterPhotos.map(toPhoto),
    });
  }
  for (const c of comments) {
    const text = (c.comment ?? "").trim();
    const photos = photosByComment.get(c.id) ?? [];
    // A photo-only post whose photo has gone says nothing — leave it out.
    if (!text && photos.length === 0) continue;
    rest.push({
      type: "comment",
      key: `comment-${c.id}`,
      at: iso(c.createdAt),
      id: c.id,
      userId: c.userId,
      userName: c.userName,
      text,
      photos,
      canDelete: canDeleteComment(viewer, c.userId),
    });
  }

  rest.sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
    if (a.type !== b.type) return ORDER[a.type] - ORDER[b.type];
    return (a.type === "comment" && b.type === "comment") ? a.id - b.id : 0;
  });

  // The submission always heads the timeline — it's what the conversation
  // is about — whatever its clock says (a Fix queue import carries the
  // issue's report time).
  return [submitted, ...rest];
}

/** Why someone is being told: it's theirs, or they're in the conversation. */
export type CommentRecipientReason = "owner" | "conversation";

/**
 * Who hears about a new comment on an improvement.
 *
 *  - Whoever logged it, everyone credited on it (the Fix queue credits the
 *    reporter), and whoever reported the issue it came from — "owner".
 *  - Anyone who has already commented — "conversation" — so a reply to
 *    Graeme's reply reaches Graeme, who neither logged nor is credited.
 *  - Never the person commenting. Each person once; an owner reason wins.
 */
export function commentRecipients(input: {
  commenterId: number | null;
  submittedBy: number | null;
  creditedUserIds: ReadonlyArray<number>;
  issueReporterIds?: ReadonlyArray<number>;
  earlierCommenterIds?: ReadonlyArray<number | null>;
}): Array<{ userId: number; reason: CommentRecipientReason }> {
  const out = new Map<number, CommentRecipientReason>();
  const ok = (id: unknown): id is number =>
    typeof id === "number" && Number.isInteger(id) && id > 0 && id !== input.commenterId;
  const owners = [input.submittedBy, ...input.creditedUserIds, ...(input.issueReporterIds ?? [])];
  for (const id of owners) if (ok(id)) out.set(id, "owner");
  for (const id of input.earlierCommenterIds ?? []) if (ok(id) && !out.has(id)) out.set(id, "conversation");
  return [...out].map(([userId, reason]) => ({ userId, reason }));
}

/** A short, one-line taste of the comment for the bell. */
export function commentSnippet(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** The words on the bell and the push. */
export function commentNotification(input: {
  commenterName: string | null;
  title: string;
  text: string;
  hasPhoto: boolean;
  reason: CommentRecipientReason;
}): { message: string; pushTitle: string; pushBody: string } {
  const who = input.commenterName?.trim() || "Someone";
  const title = commentSnippet(input.title, 60) || "an improvement";
  const where = input.reason === "owner" ? "your improvement" : `“${title}”`;
  const snippet = commentSnippet(input.text);
  if (!snippet) {
    const message = input.reason === "owner"
      ? `${who} added a photo to your improvement “${title}”`
      : `${who} added a photo to “${title}”`;
    return { message, pushTitle: `${who} added a photo`, pushBody: message };
  }
  const photo = input.hasPhoto ? " 📷" : "";
  return {
    message: `${who} replied on ${where}: “${snippet}”${photo}`,
    pushTitle: `${who} replied on ${input.reason === "owner" ? "your improvement" : "an improvement"}`,
    pushBody: `“${snippet}”${photo}`,
  };
}

/** The bell type for a comment, so the bell opens the timeline. */
export const COMMENT_NOTIFICATION_TYPE = "improvement_comment";
