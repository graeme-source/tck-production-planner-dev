/**
 * Photos and videos in team messages (Graeme, 2026-10-13: "we need to be
 * able to send picture and video information across to each other", like
 * WhatsApp). Objectives F (nothing lost) and H (team communication).
 *
 * The rules only — no database, no screen. Shared by the API
 * (routes/message-media.ts, routes/messages.ts) and the app (the compose
 * box, the bubble grid and the full-screen viewer), so the two can never
 * disagree about what is allowed or who may see it.
 *
 * The limits are the SAME as every other photo/video upload in the app
 * (to-do, improvement and andon attachments — routes/todos.ts,
 * routes/improvements.ts): JPEG/PNG/WebP/GIF photos up to 10 MB,
 * MP4/WebM/MOV/OGG videos up to 100 MB, stored as bytea in Postgres. There
 * is no client-side compression in that pipeline, so there is none here.
 */
import { canSeeMessage, type MessageFacts, type Viewer } from "./index";

export const MESSAGE_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const MESSAGE_VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime", "video/ogg"] as const;

const MB = 1024 * 1024;
export const MESSAGE_IMAGE_MAX_BYTES = 10 * MB;
export const MESSAGE_VIDEO_MAX_BYTES = 100 * MB;

/** Photos/videos on one message — WhatsApp's own album cap is 30; ten is
 *  plenty for "here's the problem" and keeps one send under a gigabyte. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

/** An upload that never made it onto a sent message (app closed, draft
 *  abandoned) is cleared after this long. */
export const PENDING_MEDIA_TTL_HOURS = 24;

/** Rough guide for the "too long" message when we can't measure the clip:
 *  an iPad records 1080p at roughly 1–2 MB a second, so 100 MB is about a
 *  minute. Only used when the real duration isn't known. */
export const TYPICAL_VIDEO_BYTES_PER_SECOND = 1.7 * MB;

export type MediaKind = "image" | "video";

/** "image" / "video" for an accepted file type, null for anything else. */
export function mediaKindOf(mime: string): MediaKind | null {
  const m = mime.toLowerCase().split(";")[0]!.trim();
  if ((MESSAGE_IMAGE_MIMES as readonly string[]).includes(m)) return "image";
  if ((MESSAGE_VIDEO_MIMES as readonly string[]).includes(m)) return "video";
  return null;
}

export const maxBytesFor = (kind: MediaKind) => (kind === "image" ? MESSAGE_IMAGE_MAX_BYTES : MESSAGE_VIDEO_MAX_BYTES);

/** "0:07", "1:05", "12:30", "1:02:03". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** How many seconds of THIS clip's quality fit under the limit — so the
 *  "too long" message can say "about 48 seconds" for the camera the person
 *  is actually holding. Falls back to the typical iPad rate. */
export function maxSecondsAtThisQuality(sizeBytes: number, durationSeconds: number | null | undefined, maxBytes = MESSAGE_VIDEO_MAX_BYTES): number {
  const rate = durationSeconds && durationSeconds > 0 && sizeBytes > 0 ? sizeBytes / durationSeconds : TYPICAL_VIDEO_BYTES_PER_SECOND;
  const secs = maxBytes / rate;
  // Round down to something sayable: 5 s steps under 2 minutes, else 15 s.
  const step = secs < 120 ? 5 : 15;
  return Math.max(step, Math.floor(secs / step) * step);
}

/** "about 45 seconds", "about 1 minute", "about 2 minutes 30 seconds". */
export function sayDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `about ${s} seconds`;
  const mins = `${m} minute${m === 1 ? "" : "s"}`;
  return s ? `about ${mins} ${s} seconds` : `about ${mins}`;
}

/** Why this file can't be sent, in words for the person holding the iPad —
 *  or null when it's fine. */
export function mediaProblem(f: { mime: string; sizeBytes: number; durationSeconds?: number | null }): string | null {
  const kind = mediaKindOf(f.mime);
  if (!kind) return "That kind of file can't be sent — photos (JPEG, PNG, WebP, GIF) or videos (MP4, MOV, WebM) only";
  if (f.sizeBytes <= 0) return "That file is empty";
  const max = maxBytesFor(kind);
  if (f.sizeBytes <= max) return null;
  const mb = Math.round(max / MB);
  if (kind === "image") return `Photo too large — max ${mb} MB`;
  return `Video too long — max ${mb} MB, ${sayDuration(maxSecondsAtThisQuality(f.sizeBytes, f.durationSeconds, max))} at this quality. Trim it or record a shorter one.`;
}

/** The words standing in for a message with no caption — chat list, push
 *  notification, reply quote, station banner. */
export function mediaPreview(kinds: readonly MediaKind[]): string {
  const photos = kinds.filter(k => k === "image").length;
  const videos = kinds.filter(k => k === "video").length;
  const parts: string[] = [];
  if (photos) parts.push(photos === 1 ? "📷 Photo" : `📷 ${photos} photos`);
  if (videos) parts.push(videos === 1 ? "🎥 Video" : `🎥 ${videos} videos`);
  return parts.join(" · ");
}

/** The caption when there is one; otherwise "📷 Photo" / "🎥 Video". With
 *  both, the caption leads with a camera so the list still says there's a
 *  picture. */
export function bodyOrMediaPreview(body: string | null | undefined, kinds: readonly MediaKind[]): string {
  const text = (body ?? "").trim();
  if (!text) return mediaPreview(kinds);
  if (kinds.length === 0) return text;
  return `${kinds.includes("image") ? "📷" : "🎥"} ${text}`;
}

// ── Who may fetch a photo or video ──────────────────────────────────────────

export interface MediaAccessFacts {
  uploadedBy: number | null;
  /** null while it's still in someone's compose box (not sent yet). */
  messageId: number | null;
  /** The message it belongs to, once sent. */
  message: (MessageFacts & { deleted: boolean }) | null;
}

/**
 * The access rule, enforced by the server on every byte it serves:
 *   - not sent yet → only the person who uploaded it;
 *   - sent → exactly the people who may see that message (canSeeMessage:
 *     the chat's participants, anyone it replies to or mentions, the
 *     station screens it's for — and managers for station chats, never for
 *     person-to-person ones);
 *   - the message was deleted → nobody.
 */
export function canFetchMessageMedia(a: MediaAccessFacts, v: Viewer): boolean {
  if (a.messageId == null) return a.uploadedBy != null && a.uploadedBy === v.userId;
  if (!a.message || a.message.deleted) return false;
  return canSeeMessage(a.message, v);
}

/** May these pending uploads go on a message this person is sending? Each
 *  must be theirs, not already sent, and there must not be too many. */
export function attachProblem(
  requestedIds: readonly number[],
  found: ReadonlyArray<{ id: number; uploadedBy: number | null; messageId: number | null }>,
  senderUserId: number,
): string | null {
  if (requestedIds.length > MAX_ATTACHMENTS_PER_MESSAGE) return `Up to ${MAX_ATTACHMENTS_PER_MESSAGE} photos or videos per message`;
  if (new Set(requestedIds).size !== requestedIds.length) return "The same photo was attached twice";
  for (const id of requestedIds) {
    const f = found.find(x => x.id === id);
    if (!f || f.uploadedBy !== senderUserId) return "A photo or video is missing — remove it and add it again";
    if (f.messageId != null) return "That photo or video has already been sent";
  }
  return null;
}

// ── The bubble grid ─────────────────────────────────────────────────────────

/**
 * How several photos sit in one bubble, WhatsApp-style:
 *   1 → one picture at its own shape
 *   2 → side by side
 *   3 → one across the top, two below
 *   4+ → a 2×2 grid; the fourth tile says "+N" for the rest
 * Returns how many tiles to draw, the overflow count on the last tile, and
 * which tiles span both columns.
 */
export function mediaGrid(count: number): { tiles: number; overflow: number; wide: number[] } {
  if (count <= 0) return { tiles: 0, overflow: 0, wide: [] };
  if (count === 1) return { tiles: 1, overflow: 0, wide: [0] };
  if (count === 2) return { tiles: 2, overflow: 0, wide: [] };
  if (count === 3) return { tiles: 3, overflow: 0, wide: [0] };
  return { tiles: 4, overflow: count - 4, wide: [] };
}

/** Next/previous in the full-screen viewer, stopping at the ends. */
export function stepIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, current + delta));
}
