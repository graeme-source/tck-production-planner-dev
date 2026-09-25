// Photos & videos attached to an improvement. Shared by the Improvements
// page, the report detail modal, and the morning-meeting "Recent
// Improvements" slide. Media is stored in Postgres and streamed from
// /api/improvements/attachments/:id (same bytea pattern as SOP step media).
import { useEffect, useState } from "react";
import { Loader2, Camera, Upload, Trash2, X, Play, AlertTriangle, Download, RotateCcw } from "lucide-react";
import { stashCapture, readStash, clearStash, saveFileToDevice, type StashedCapture } from "@/lib/capture-safety";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Attachment {
  id: number;
  kind: string; // "image" | "video"
  mime: string;
  fileName: string | null;
  createdAt: string;
  phase: "before" | "after" | "stitched" | null;
}

const attachmentUrl = (id: number) => `${BASE}/api/improvements/attachments/${id}`;

export function ImprovementAttachments({
  improvementId,
  editable = false,
  thumbSize = "w-24 h-24",
  fullWidth = false,
  phase,
  onChanged,
}: {
  improvementId: number;
  editable?: boolean;
  thumbSize?: string;
  /** Each photo/video the full width of its container, stacked, videos
   *  playing in place — for the improvement's own page. */
  fullWidth?: boolean;
  /** Fired after an upload or a removal. The improvement's own state can
   *  change as a side effect — a photo on a to-do improvement sends it for
   *  approval — so the screen around this has to reload, not just the grid. */
  onChanged?: () => void;
  /** Show (and upload into) only one side of a before/after pair, or the
   *  joined clip. Omit to show everything, which is what the older callers
   *  still want. */
  phase?: "before" | "after" | "stitched";
}) {
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<Attachment | null>(null);
  // A capture whose upload failed — HELD, never discarded (Graeme,
  // 2026-09-14: a failed after-video used to be lost outright, because iOS
  // hands the app a temp file that never reached the camera roll).
  const [failed, setFailed] = useState<{ file: File; reason: string } | null>(null);
  // A capture stashed locally by an earlier session that never uploaded.
  const [recovered, setRecovered] = useState<StashedCapture | null>(null);

  useEffect(() => {
    if (!editable) return;
    void readStash().then(s => { if (s) setRecovered(s); });
  }, [editable]);

  const load = () =>
    fetch(`${BASE}/api/improvements/${improvementId}/attachments`, { credentials: "include" })
      .then(r => (r.ok ? r.json() : []))
      .then((all: Attachment[]) => setItems(
        // Media logged before the before/after split has no phase; it shows
        // under "before", where an existing photo of a problem belongs. The
        // joined clip only ever appears in its own slot.
        phase
          ? all.filter(a =>
              phase === "before"
                ? a.phase !== "after" && a.phase !== "stitched"
                : a.phase === phase)
          : all,
      ))
      .catch(() => setItems([]));

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [improvementId]);

  const upload = async (file: File) => {
    setUploading(true);
    setFailed(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (phase) form.append("phase", phase);
      const r = await fetch(`${BASE}/api/improvements/${improvementId}/attachments`, {
        method: "POST", credentials: "include", body: form,
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        // HOLD the file — the failure card offers retry / save to phone.
        setFailed({ file, reason: d.error ?? `Upload failed (HTTP ${r.status})` });
        return;
      }
      // Server has it — the local safety copy can go.
      void clearStash();
      setRecovered(null);
      await load();
      onChanged?.();
    } catch {
      // A dropped connection used to be SILENT and the file was lost with
      // it. Now it lands in the failure card like any other failure.
      setFailed({ file, reason: "The upload didn't reach the server — check the Wi-Fi and try again." });
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Remove this attachment?")) return;
    await fetch(`${BASE}/api/improvements/attachments/${id}`, { method: "DELETE", credentials: "include" });
    await load();
    onChanged?.();
  };

  const pick = (accept: string, capture?: boolean, maxBytes?: number) => (
    <input
      type="file"
      accept={accept}
      {...(capture ? { capture: "environment" as const } : {})}
      className="hidden"
      onChange={e => {
        const f = e.target.files?.[0];
        if (f) {
          // Local safety copy FIRST — a fresh camera capture on iOS exists
          // only as a temp file until the server has it.
          void stashCapture(f, improvementId, phase ?? null);
          if (maxBytes && f.size > maxBytes) {
            setFailed({ file: f, reason: `Too large to upload (max ${Math.round(maxBytes / 1024 / 1024)}MB) — save it to your phone so it isn't lost.` });
          } else {
            void upload(f);
          }
        }
        e.target.value = "";
      }}
    />
  );

  /** The failure / recovery card's shared actions. */
  const saveToPhone = async (file: File) => {
    const ok = await saveFileToDevice(file);
    if (!ok) return; // share sheet cancelled — keep the card
  };
  const discardHeld = () => {
    setFailed(null);
    setRecovered(null);
    void clearStash();
  };
  const stashAsFile = (s: StashedCapture) => new File([s.blob], s.name, { type: s.mime });

  return (
    <div>
      {editable && (
        <div className="flex flex-wrap gap-2 mb-2">
          <label className="text-xs px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-secondary cursor-pointer flex items-center gap-1.5">
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />} Take photo
            {pick("image/*", true, 10 * 1024 * 1024)}
          </label>
          <label className="text-xs px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-secondary cursor-pointer flex items-center gap-1.5">
            <Upload className="w-3.5 h-3.5" /> Photo
            {pick("image/*", false, 10 * 1024 * 1024)}
          </label>
          <label className="text-xs px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-secondary cursor-pointer flex items-center gap-1.5">
            <Upload className="w-3.5 h-3.5" /> Video
            {pick("video/mp4,video/webm,video/quicktime,video/ogg", false, 100 * 1024 * 1024)}
          </label>
        </div>
      )}

      {/* Upload failure — the capture is HELD, with every way out of losing
          it. "Save to phone" opens the share sheet, where Save Video/Image
          puts it in the camera roll. */}
      {editable && failed && (
        <div className="mb-2 rounded-xl border-2 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-3 space-y-2">
          <p className="text-sm font-semibold text-red-800 dark:text-red-200 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" /> This {failed.file.type.startsWith("video") ? "video" : "photo"} hasn't been saved yet
          </p>
          <p className="text-xs text-red-700/90 dark:text-red-300/90">{failed.reason}</p>
          <div className="flex flex-wrap gap-2">
            {!failed.reason.startsWith("Too large") && (
              <button onClick={() => upload(failed.file)} disabled={uploading}
                className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white font-semibold flex items-center gap-1.5 disabled:opacity-50">
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Try again
              </button>
            )}
            <button onClick={() => saveToPhone(failed.file)}
              className="text-xs px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-800 bg-background font-semibold flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" /> Save to phone
            </button>
            <button onClick={discardHeld} className="text-xs px-3 py-1.5 rounded-lg text-red-700 dark:text-red-300">
              Discard
            </button>
          </div>
        </div>
      )}

      {/* A capture stashed by an earlier session that never made it up —
          e.g. the app was closed on a failed upload. Offer it back. */}
      {editable && !failed && recovered && (
        <div className="mb-2 rounded-xl border-2 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-100 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            Unsaved {recovered.mime.startsWith("video") ? "video" : "photo"} from {new Date(recovered.at).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}{recovered.phase ? ` (${recovered.phase})` : ""}
          </p>
          <p className="text-xs text-amber-800/90 dark:text-amber-200/90">It never finished uploading — it's still safe on this device.</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => upload(stashAsFile(recovered))} disabled={uploading}
              className="text-xs px-3 py-1.5 rounded-lg bg-amber-600 text-white font-semibold flex items-center gap-1.5 disabled:opacity-50">
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Upload here
            </button>
            <button onClick={() => saveToPhone(stashAsFile(recovered))}
              className="text-xs px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-background font-semibold flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" /> Save to phone
            </button>
            <button onClick={discardHeld} className="text-xs px-3 py-1.5 rounded-lg text-amber-800 dark:text-amber-200">
              Discard
            </button>
          </div>
        </div>
      )}

      {items === null ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      ) : items.length === 0 ? (
        editable ? <p className="text-xs text-muted-foreground">No photos or videos yet.</p> : null
      ) : (
        <div className={fullWidth ? "space-y-3" : "flex flex-wrap gap-2"}>
          {items.map(a => (
            <div key={a.id} className={fullWidth ? "relative w-full" : "relative group"}>
              {fullWidth ? (
                a.kind === "video" ? (
                  <video src={attachmentUrl(a.id)} controls playsInline preload="metadata" className="w-full max-h-[80vh] rounded-xl bg-black" />
                ) : (
                  <button onClick={() => setLightbox(a)} title="View photo" className="block w-full">
                    <img src={attachmentUrl(a.id)} alt="" className="w-full h-auto max-h-[80vh] object-contain rounded-xl border border-border bg-black/5" loading="lazy" />
                  </button>
                )
              ) : a.kind === "video" ? (
                <button
                  onClick={() => setLightbox(a)}
                  className={`${thumbSize} rounded-lg border border-border bg-black flex items-center justify-center text-white`}
                  title="Play video"
                >
                  <Play className="w-6 h-6" />
                </button>
              ) : (
                <button onClick={() => setLightbox(a)} title="View photo">
                  <img src={attachmentUrl(a.id)} alt="" className={`${thumbSize} rounded-lg object-cover border border-border`} loading="lazy" />
                </button>
              )}
              {/* Always visible — it was hover-only, which on an iPad means
                  it doesn't exist (Graeme, 2026-09-02: couldn't remove a
                  photo at all). */}
              {editable && (
                <button
                  onClick={() => remove(a.id)}
                  className={fullWidth
                    ? "absolute top-3 right-3 bg-red-500 text-white rounded-full p-2.5 shadow-md active:scale-95 transition-transform"
                    : "absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1.5 shadow-md active:scale-95 transition-transform"}
                  title="Remove"
                  aria-label="Remove this photo or video"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {lightbox && (
        <div className="fixed inset-0 z-[200] bg-black/85 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <button className="absolute top-4 right-4 text-white" title="Close"><X className="w-8 h-8" /></button>
          {lightbox.kind === "video" ? (
            <video src={attachmentUrl(lightbox.id)} controls autoPlay playsInline className="max-w-full max-h-full rounded-lg bg-black" onClick={e => e.stopPropagation()} />
          ) : (
            <img src={attachmentUrl(lightbox.id)} alt="" className="max-w-full max-h-full rounded-lg" onClick={e => e.stopPropagation()} />
          )}
        </div>
      )}
    </div>
  );
}
