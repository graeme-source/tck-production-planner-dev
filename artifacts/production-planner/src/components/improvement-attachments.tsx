// Photos & videos attached to an improvement. Shared by the Improvements
// page, the report detail modal, and the morning-meeting "Recent
// Improvements" slide. Media is stored in Postgres and streamed from
// /api/improvements/attachments/:id (same bytea pattern as SOP step media).
import { useEffect, useState } from "react";
import { Loader2, Camera, Upload, Trash2, X, Play } from "lucide-react";

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
  phase,
}: {
  improvementId: number;
  editable?: boolean;
  thumbSize?: string;
  /** Show (and upload into) only one side of a before/after pair, or the
   *  joined clip. Omit to show everything, which is what the older callers
   *  still want. */
  phase?: "before" | "after" | "stitched";
}) {
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<Attachment | null>(null);

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
    try {
      const form = new FormData();
      form.append("file", file);
      if (phase) form.append("phase", phase);
      const r = await fetch(`${BASE}/api/improvements/${improvementId}/attachments`, {
        method: "POST", credentials: "include", body: form,
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d.error ?? "Upload failed");
      }
      await load();
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Remove this attachment?")) return;
    await fetch(`${BASE}/api/improvements/attachments/${id}`, { method: "DELETE", credentials: "include" });
    load();
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
          if (maxBytes && f.size > maxBytes) { alert(`File too large (max ${Math.round(maxBytes / 1024 / 1024)}MB).`); }
          else upload(f);
        }
        e.target.value = "";
      }}
    />
  );

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

      {items === null ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      ) : items.length === 0 ? (
        editable ? <p className="text-xs text-muted-foreground">No photos or videos yet.</p> : null
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map(a => (
            <div key={a.id} className="relative group">
              {a.kind === "video" ? (
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
              {editable && (
                <button
                  onClick={() => remove(a.id)}
                  className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove"
                >
                  <Trash2 className="w-3 h-3" />
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
