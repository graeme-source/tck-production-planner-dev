/**
 * Photos and videos in messages (Graeme, 2026-10-13) — the bubble grid,
 * the full-screen viewer and the compose-box tray. Rules (limits, grid
 * layout, previews) live in @workspace/messages media.ts.
 *
 * Viewer follows the standing modal rule: an X to close (and Escape, and
 * tapping the dark background), nothing can trap you. Swipe or the arrows
 * move between a message's photos/videos; a video plays in place; Save
 * opens the iPad share sheet (Save Image / Save Video) — the same
 * save-to-device path improvement captures use.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Play, ChevronLeft, ChevronRight, Download, Loader2, RotateCcw, AlertTriangle, Film } from "lucide-react";
import { mediaGrid, stepIndex, formatDuration } from "@workspace/messages";
import { cn } from "@/lib/utils";
import { saveFileToDevice } from "@/lib/capture-safety";
import { toast } from "@/hooks/use-toast";
import { mediaUrl, type ApiAttachment } from "./messages-api";
import type { DraftMedia } from "./media-drafts";

// ── In the bubble ───────────────────────────────────────────────────────────

/** One tile. Videos show their first frame (#t= trick — needs the Range
 *  support the server has), a play button and the length. */
function Tile({ a, at, className, overflow }: { a: ApiAttachment; at: string[]; className?: string; overflow?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className={cn("relative overflow-hidden bg-black/10 dark:bg-white/5", className)}>
      {broken ? (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground p-2 text-center">Couldn't load</div>
      ) : a.kind === "image" ? (
        <img src={mediaUrl(a.id, at)} alt="Photo" loading="lazy" onError={() => setBroken(true)} className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <video
          src={`${mediaUrl(a.id, at)}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          onError={() => setBroken(true)}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none bg-black"
        />
      )}
      {a.kind === "video" && !overflow && (
        <>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-12 h-12 rounded-full bg-black/55 flex items-center justify-center">
              <Play className="w-6 h-6 text-white fill-white ml-0.5" />
            </div>
          </div>
          {a.durationSeconds != null && (
            <span className="absolute bottom-1.5 left-1.5 text-[11px] font-semibold text-white bg-black/60 rounded px-1.5 py-0.5 flex items-center gap-1 pointer-events-none">
              <Film className="w-3 h-3" /> {formatDuration(a.durationSeconds)}
            </span>
          )}
        </>
      )}
      {!!overflow && (
        <div className="absolute inset-0 bg-black/55 flex items-center justify-center text-white text-2xl font-bold pointer-events-none">+{overflow}</div>
      )}
    </div>
  );
}

/** A message's photos and videos, laid out like WhatsApp: one at its own
 *  shape, two side by side, three as one wide + two, four or more as a
 *  2×2 with "+N". Tap any to open the viewer at it. */
export function MessageMediaGrid({ attachments, at, onOpen, className }: {
  attachments: ApiAttachment[]; at: string[]; onOpen: (index: number) => void; className?: string;
}) {
  const { tiles, overflow, wide } = mediaGrid(attachments.length);
  if (tiles === 0) return null;
  if (tiles === 1) {
    const a = attachments[0]!;
    // Its own shape, kept within sensible bounds (no 1:4 panoramas).
    const ratio = a.width && a.height ? Math.min(1.8, Math.max(0.6, a.width / a.height)) : a.kind === "video" ? 16 / 9 : 4 / 3;
    return (
      <button
        type="button"
        onClick={() => onOpen(0)}
        style={{ aspectRatio: String(ratio) }}
        className={cn("block w-[min(280px,62vw)] md:w-[300px] max-h-[360px] rounded-xl overflow-hidden", className)}
        aria-label={a.kind === "video" ? "Play video" : "Open photo"}
      >
        <Tile a={a} at={at} className="w-full h-full" />
      </button>
    );
  }
  return (
    <div className={cn("grid grid-cols-2 gap-1 w-[min(280px,62vw)] md:w-[300px] rounded-xl overflow-hidden", className)}>
      {attachments.slice(0, tiles).map((a, i) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onOpen(i)}
          className={cn("block", wide.includes(i) ? "col-span-2 aspect-[2/1]" : "aspect-square")}
          aria-label={i === tiles - 1 && overflow ? `Open — ${overflow} more` : a.kind === "video" ? "Play video" : "Open photo"}
        >
          <Tile a={a} at={at} className="w-full h-full" overflow={i === tiles - 1 ? overflow : 0} />
        </button>
      ))}
    </div>
  );
}

// ── Full screen ─────────────────────────────────────────────────────────────

export function MediaViewer({ attachments, startIndex, at, caption, onClose }: {
  attachments: ApiAttachment[]; startIndex: number; at: string[]; caption?: string | null; onClose: () => void;
}) {
  const [index, setIndex] = useState(() => stepIndex(startIndex, 0, attachments.length));
  const [saving, setSaving] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const a = attachments[index];
  const go = (d: number) => setIndex(i => stepIndex(i, d, attachments.length));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    // Capture, so Escape closes the viewer and not the Messages panel under it.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, attachments.length]);

  if (!a) return null;

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(mediaUrl(a.id, at), { credentials: "include" });
      if (!r.ok) throw new Error(`Couldn't fetch it (${r.status})`);
      const blob = await r.blob();
      const ext = a.mime.split("/")[1]?.replace("quicktime", "mov").replace("jpeg", "jpg") ?? "bin";
      await saveFileToDevice(new File([blob], `tck-message-${a.id}.${ext}`, { type: a.mime }));
    } catch (err) {
      toast({ title: "Couldn't save", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[250] bg-black/95 flex flex-col"
      role="dialog"
      aria-label={a.kind === "video" ? "Video" : "Photo"}
      onClick={onClose}
      onTouchStart={e => { const t = e.touches[0]; if (t) touch.current = { x: t.clientX, y: t.clientY }; }}
      onTouchEnd={e => {
        const s = touch.current; const t = e.changedTouches[0];
        touch.current = null;
        if (!s || !t) return;
        const dx = t.clientX - s.x, dy = t.clientY - s.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
        else if (dy > 120 && Math.abs(dy) > Math.abs(dx) * 1.5) onClose(); // swipe down closes, like Photos
      }}
    >
      <div className="flex items-center gap-2 px-3 py-3 text-white flex-shrink-0" onClick={e => e.stopPropagation()}>
        <span className="flex-1 text-sm font-semibold">{attachments.length > 1 ? `${index + 1} of ${attachments.length}` : a.kind === "video" ? "Video" : "Photo"}</span>
        <button onClick={save} disabled={saving} className="h-11 px-4 rounded-xl bg-white/15 hover:bg-white/25 font-semibold flex items-center gap-2 disabled:opacity-60">
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />} Save
        </button>
        <button onClick={onClose} className="h-11 w-11 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center" aria-label="Close">
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="relative flex-1 min-h-0 flex items-center justify-center px-2">
        {a.kind === "video" ? (
          <video
            key={a.id}
            src={mediaUrl(a.id, at)}
            controls
            autoPlay
            playsInline
            className="max-w-full max-h-full rounded-lg bg-black"
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <img key={a.id} src={mediaUrl(a.id, at)} alt="Photo" className="max-w-full max-h-full object-contain select-none" onClick={e => e.stopPropagation()} />
        )}
        {index > 0 && (
          <button onClick={e => { e.stopPropagation(); go(-1); }} className="absolute left-2 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/15 hover:bg-white/30 text-white flex items-center justify-center" aria-label="Previous">
            <ChevronLeft className="w-7 h-7" />
          </button>
        )}
        {index < attachments.length - 1 && (
          <button onClick={e => { e.stopPropagation(); go(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/15 hover:bg-white/30 text-white flex items-center justify-center" aria-label="Next">
            <ChevronRight className="w-7 h-7" />
          </button>
        )}
      </div>

      {caption && (
        <p className="text-white/90 text-base px-4 py-3 text-center flex-shrink-0 max-h-[20dvh] overflow-y-auto whitespace-pre-wrap" onClick={e => e.stopPropagation()}>{caption}</p>
      )}
    </div>,
    document.body,
  );
}

// ── In the compose box ──────────────────────────────────────────────────────

/** Picked photos/videos before Send: thumbnail, progress, Try again,
 *  remove. A refused file says why in red and in words. */
export function DraftMediaTray({ items, onRetry, onRemove }: {
  items: DraftMedia[]; onRetry: (localId: string) => void; onRemove: (localId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2 overflow-x-auto pb-1 overscroll-contain">
        {items.map(i => (
          <div key={i.localId} className={cn("relative w-24 h-24 flex-shrink-0 rounded-xl overflow-hidden border-2 bg-black", i.status === "failed" || i.status === "refused" ? "border-red-500" : "border-border")}>
            {i.kind === "image"
              ? <img src={i.previewUrl} alt="" className="w-full h-full object-cover" />
              : <video src={`${i.previewUrl}#t=0.1`} muted playsInline preload="metadata" className="w-full h-full object-cover pointer-events-none" />}
            {i.kind === "video" && i.durationSeconds != null && (
              <span className="absolute bottom-1 left-1 text-[10px] font-semibold text-white bg-black/60 rounded px-1">{formatDuration(i.durationSeconds)}</span>
            )}
            {i.status === "uploading" && (
              <div className="absolute inset-0 bg-black/45 flex flex-col items-center justify-center text-white">
                <span className="text-sm font-bold">{Math.round(i.progress * 100)}%</span>
                <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-white/25">
                  <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(i.progress * 100)}%` }} />
                </div>
              </div>
            )}
            {i.status === "failed" && (
              <button onClick={() => onRetry(i.localId)} className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-white gap-1" aria-label="Try the upload again">
                <RotateCcw className="w-6 h-6" />
                <span className="text-xs font-bold">Try again</span>
              </button>
            )}
            {i.status === "refused" && (
              <div className="absolute inset-0 bg-red-900/70 flex items-center justify-center text-white"><AlertTriangle className="w-7 h-7" /></div>
            )}
            <button
              onClick={() => onRemove(i.localId)}
              className="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/70 text-white flex items-center justify-center"
              aria-label="Remove this photo or video"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
      {items.filter(i => i.error && (i.status === "failed" || i.status === "refused")).map(i => (
        <p key={i.localId} className="text-sm font-semibold text-red-600" role="alert">
          {/^(Photo|Video)\b/.test(i.error ?? "") ? i.error : `${i.kind === "video" ? "Video" : "Photo"}: ${i.error}`}
        </p>
      ))}
    </div>
  );
}
