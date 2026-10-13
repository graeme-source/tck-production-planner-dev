/**
 * Photos and videos waiting in a chat's compose box (Graeme, 2026-10-13).
 *
 * Each file starts uploading the moment it's picked, so Send is quick and
 * every file shows its own progress. A failed upload stays in the box with
 * a "Try again" — the file and the typed caption are never thrown away.
 *
 * Kept per chat in a module-level store (like the text drafts in
 * compose-box.tsx): close the Messages panel mid-upload, open it again,
 * and the uploads are still there, still going.
 */
import { useSyncExternalStore } from "react";
import { mediaKindOf, mediaProblem, MAX_ATTACHMENTS_PER_MESSAGE, type MediaKind } from "@workspace/messages";
import { uploadMessageMedia, discardMessageMedia, type ApiAttachment } from "./messages-api";

export type DraftMediaStatus = "uploading" | "done" | "failed" | "refused";

export interface DraftMedia {
  localId: string;
  file: File;
  kind: MediaKind;
  /** Object URL for the thumbnail — the file itself, no upload needed. */
  previewUrl: string;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  status: DraftMediaStatus;
  progress: number;          // 0–1
  error: string | null;
  uploaded: ApiAttachment | null;
}

const drafts = new Map<string, DraftMedia[]>();
const inflight = new Map<string, Promise<void>>(); // localId → upload
const listeners = new Set<() => void>();
const EMPTY: DraftMedia[] = [];

function emit() { listeners.forEach(l => l()); }
function setItems(key: string, items: DraftMedia[]) {
  if (items.length) drafts.set(key, items); else drafts.delete(key);
  emit();
}
function patch(key: string, localId: string, change: Partial<DraftMedia>) {
  const items = drafts.get(key);
  if (!items) return;
  setItems(key, items.map(i => (i.localId === localId ? { ...i, ...change } : i)));
}

export function useDraftMedia(key: string): DraftMedia[] {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb); },
    () => drafts.get(key) ?? EMPTY,
  );
}

/** What the app can learn about a file before uploading: a video's length
 *  (for "0:42" and the too-long message) and the picture's shape (so the
 *  bubble lays out before the bytes arrive). Never blocks for long. */
function measure(file: File, url: string, kind: MediaKind): Promise<{ durationSeconds: number | null; width: number | null; height: number | null }> {
  const none = { durationSeconds: null, width: null, height: null };
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(none), 4000);
    const done = (r: typeof none | { durationSeconds: number | null; width: number | null; height: number | null }) => { clearTimeout(timer); resolve(r); };
    if (kind === "image") {
      const img = new Image();
      img.onload = () => done({ durationSeconds: null, width: img.naturalWidth || null, height: img.naturalHeight || null });
      img.onerror = () => done(none);
      img.src = url;
    } else {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.onloadedmetadata = () => done({
        durationSeconds: Number.isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : null,
        width: v.videoWidth || null,
        height: v.videoHeight || null,
      });
      v.onerror = () => done(none);
      v.src = url;
    }
    void file;
  });
}

function startUpload(key: string, item: DraftMedia): Promise<void> {
  patch(key, item.localId, { status: "uploading", progress: 0, error: null });
  const p = uploadMessageMedia(
    item.file,
    { durationSeconds: item.durationSeconds, width: item.width, height: item.height },
    fraction => patch(key, item.localId, { progress: fraction }),
  )
    .then(uploaded => patch(key, item.localId, { status: "done", progress: 1, uploaded }))
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : "Upload failed";
      // The server refusing the file itself (too big, wrong type) can't be
      // fixed by trying again; a dropped connection can.
      const refused = /too (large|long)|can't be sent|empty/i.test(msg);
      patch(key, item.localId, { status: refused ? "refused" : "failed", error: msg });
    })
    .finally(() => inflight.delete(item.localId));
  inflight.set(item.localId, p);
  return p;
}

let seq = 0;

/** Add picked files to a chat's compose box and start uploading them.
 *  Returns a sentence when some couldn't be added (over the per-message cap). */
export function addDraftMedia(key: string, files: File[]): string | null {
  const room = MAX_ATTACHMENTS_PER_MESSAGE - (drafts.get(key)?.length ?? 0);
  const taking = files.slice(0, Math.max(0, room));
  for (const file of taking) {
    const kind = mediaKindOf(file.type) ?? (file.type.startsWith("video") ? "video" : "image");
    const previewUrl = URL.createObjectURL(file);
    const item: DraftMedia = {
      localId: `m${Date.now()}-${seq++}`, file, kind, previewUrl,
      durationSeconds: null, width: null, height: null,
      status: "uploading", progress: 0, error: null, uploaded: null,
    };
    setItems(key, [...(drafts.get(key) ?? []), item]);
    // Measure, check, upload — registered as in flight from the start so a
    // Send tapped straight away waits for it.
    const chain = measure(file, previewUrl, kind).then(m => {
      patch(key, item.localId, m);
      const problem = mediaProblem({ mime: file.type, sizeBytes: file.size, durationSeconds: m.durationSeconds });
      if (problem) { patch(key, item.localId, { status: "refused", error: problem }); return; }
      return startUpload(key, { ...item, ...m });
    });
    inflight.set(item.localId, chain);
  }
  return files.length > taking.length
    ? `Up to ${MAX_ATTACHMENTS_PER_MESSAGE} photos or videos per message — ${files.length - taking.length} left out`
    : null;
}

export function retryDraftMedia(key: string, localId: string) {
  const item = drafts.get(key)?.find(i => i.localId === localId);
  if (item && item.status === "failed") startUpload(key, item);
}

export function removeDraftMedia(key: string, localId: string) {
  const items = drafts.get(key) ?? [];
  const item = items.find(i => i.localId === localId);
  if (!item) return;
  URL.revokeObjectURL(item.previewUrl);
  setItems(key, items.filter(i => i.localId !== localId));
  // Tidy the server copy; if this fails the server clears unsent uploads
  // after a day anyway, so a warning is enough.
  if (item.uploaded) {
    discardMessageMedia(item.uploaded.id).catch(err => console.warn("[messages] couldn't discard upload:", err));
  }
}

/** After a send: the files are on the message now — clear the box (without
 *  deleting the server copies). */
export function clearDraftMedia(key: string) {
  for (const i of drafts.get(key) ?? []) URL.revokeObjectURL(i.previewUrl);
  setItems(key, []);
}

/**
 * Wait for this chat's uploads to finish. Returns the uploaded ids in the
 * order picked, or the reason it can't send yet (something failed or was
 * refused — it stays in the box with its own Try again / remove).
 */
export async function settleDraftMedia(key: string): Promise<{ ids: number[]; problem: string | null }> {
  const pending = (drafts.get(key) ?? []).map(i => inflight.get(i.localId)).filter(Boolean);
  await Promise.all(pending);
  const items = drafts.get(key) ?? [];
  const bad = items.filter(i => i.status !== "done");
  if (bad.length) {
    const what = bad.length === 1 ? `1 ${bad[0]!.kind === "video" ? "video" : "photo"}` : `${bad.length} photos or videos`;
    const refused = bad.some(i => i.status === "refused");
    return {
      ids: [],
      problem: refused
        ? `${what} can't be sent — remove ${bad.length === 1 ? "it" : "them"} (see the red note) and tap Send again`
        : `${what} didn't upload — tap Try again on ${bad.length === 1 ? "it" : "them"}, then Send`,
    };
  }
  return { ids: items.map(i => i.uploaded!.id), problem: null };
}
