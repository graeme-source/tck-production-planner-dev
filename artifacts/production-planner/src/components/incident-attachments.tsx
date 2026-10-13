/**
 * Photos & short videos on an accident / incident report (Graeme,
 * 2026-10-13: "I've got a foreign object report here that I need to upload
 * an image to"). Objective B — HACCP evidence.
 *
 * Same capture flow as improvement photos (components/improvement-attachments
 * .tsx), which is the one proven on the iPad camera: "Take photo" opens the
 * rear camera, the capture is stashed on the device BEFORE the upload
 * (lib/capture-safety) and a failed upload is held with Try again / Save to
 * phone, never lost. Bytes are stored in Postgres like improvement media.
 *
 * Evidence rules (server-enforced, see api-server lib/incident-attachment-
 * rules): a photo can be added at any time, including after signing — then
 * it is marked "Added after signing" with who and when, and the signed
 * report itself is untouched. "Remove" is a soft delete: the photo leaves
 * the report but stays on record, shown under "Removed" with who/when/why.
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, Camera, ImagePlus, Video, Trash2, X, Play, AlertTriangle, Download, RotateCcw, PenLine, ChevronDown, ChevronUp } from "lucide-react";
import { stashCapture, readStash, clearStash, saveFileToDevice, type StashedCapture } from "@/lib/capture-safety";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface IncidentAttachment {
  id: number;
  kind: "image" | "video";
  mime: string;
  fileName: string | null;
  uploadedByName: string | null;
  addedAfterSigning: boolean;
  createdAt: string;
  deletedAt: string | null;
  deletedByName: string | null;
  deleteReason: string | null;
}

export const incidentAttachmentUrl = (id: number) => `${BASE}/api/incidents/attachments/${id}`;

export const incidentAttachmentsKey = (incidentId: number) => ["incident-attachments", incidentId] as const;

const IMAGE_MAX = 15 * 1024 * 1024;
const VIDEO_MAX = 100 * 1024 * 1024;

export function IncidentAttachments({ incidentId, onChanged }: { incidentId: number; onChanged?: () => void }) {
  const queryClient = useQueryClient();
  const [lightbox, setLightbox] = useState<IncidentAttachment | null>(null);
  const [failed, setFailed] = useState<{ file: File; reason: string } | null>(null);
  const [recovered, setRecovered] = useState<StashedCapture | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);

  const { data: all, isLoading } = useQuery<IncidentAttachment[]>({
    queryKey: incidentAttachmentsKey(incidentId),
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/incidents/${incidentId}/attachments`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load photos");
      return res.json();
    },
  });
  const live = (all ?? []).filter(a => !a.deletedAt);
  const removed = (all ?? []).filter(a => a.deletedAt);

  // A capture held from an earlier, failed incident upload — offer it back.
  useEffect(() => {
    void readStash("incident").then(s => { if (s) setRecovered(s); });
  }, []);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: incidentAttachmentsKey(incidentId) });
    onChanged?.();
  };

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      let r: Response;
      try {
        r = await fetch(`${BASE}/api/incidents/${incidentId}/attachments`, { method: "POST", credentials: "include", body: form });
      } catch {
        throw new Error("The upload didn't reach the server — check the Wi-Fi and try again.");
      }
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `Upload failed (HTTP ${r.status})`);
      }
      return r.json() as Promise<{ id: number; addedAfterSigning: boolean }>;
    },
    onMutate: () => setFailed(null),
    onSuccess: (row) => {
      void clearStash();
      setRecovered(null);
      refresh();
      toast({
        title: "Saved to the report",
        description: row.addedAfterSigning ? "The report is already signed, so it's marked \"added after signing\"." : undefined,
      });
    },
    // HOLD the file — the failure card offers retry / save to phone.
    onError: (e, file) => setFailed({ file, reason: e instanceof Error ? e.message : String(e) }),
  });

  const remove = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      const r = await fetch(`${BASE}/api/incidents/attachments/${id}/remove`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || undefined }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to remove");
    },
    onSuccess: () => { setLightbox(null); refresh(); },
    onError: (e) => toast({ title: "Couldn't remove it", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  const askRemove = (a: IncidentAttachment) => {
    const reason = window.prompt("Remove this from the report? It stays on record as removed, with your name.\n\nWhy? (optional)", "");
    if (reason === null) return; // cancelled
    remove.mutate({ id: a.id, reason: reason.trim() });
  };

  const onPicked = (f: File, maxBytes: number) => {
    // Local safety copy FIRST — a fresh camera capture on iOS exists only as
    // a temp file until the server has it.
    void stashCapture(f, incidentId, null, "incident");
    if (f.size > maxBytes) {
      setFailed({ file: f, reason: `Too large to upload (max ${Math.round(maxBytes / 1024 / 1024)}MB) — save it to your phone so it isn't lost.` });
      return;
    }
    upload.mutate(f);
  };

  const pick = (accept: string, maxBytes: number, capture?: boolean) => (
    <input
      type="file"
      accept={accept}
      {...(capture ? { capture: "environment" as const } : {})}
      className="hidden"
      onChange={e => {
        const f = e.target.files?.[0];
        if (f) onPicked(f, maxBytes);
        e.target.value = "";
      }}
    />
  );

  const discardHeld = () => { setFailed(null); setRecovered(null); void clearStash(); };
  const stashAsFile = (s: StashedCapture) => new File([s.blob], s.name, { type: s.mime });
  const uploading = upload.isPending;
  const btn = "min-h-[52px] px-4 rounded-xl border-2 border-border bg-background hover:bg-secondary/40 cursor-pointer inline-flex items-center gap-2 text-sm font-semibold active:scale-[0.98] transition-transform";

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        <label className={cn(btn, "border-primary/50 bg-primary/5")}>
          {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5 text-primary" />} Take photo
          {pick("image/*", IMAGE_MAX, true)}
        </label>
        <label className={btn}>
          <ImagePlus className="w-5 h-5" /> Choose photo
          {pick("image/*", IMAGE_MAX)}
        </label>
        <label className={btn}>
          <Video className="w-5 h-5" /> Video
          {pick("video/mp4,video/webm,video/quicktime,video/ogg", VIDEO_MAX)}
        </label>
      </div>

      {failed && (
        <div className="mb-3 rounded-xl border-2 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-3 space-y-2">
          <p className="text-sm font-semibold text-red-800 dark:text-red-200 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" /> This {failed.file.type.startsWith("video") ? "video" : "photo"} hasn't been saved yet
          </p>
          <p className="text-xs text-red-700/90 dark:text-red-300/90">{failed.reason}</p>
          <div className="flex flex-wrap gap-2">
            {!failed.reason.startsWith("Too large") && (
              <button onClick={() => upload.mutate(failed.file)} disabled={uploading}
                className="text-sm px-3 py-2 rounded-lg bg-red-600 text-white font-semibold flex items-center gap-1.5 disabled:opacity-50">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} Try again
              </button>
            )}
            <button onClick={() => void saveFileToDevice(failed.file)}
              className="text-sm px-3 py-2 rounded-lg border border-red-300 dark:border-red-800 bg-background font-semibold flex items-center gap-1.5">
              <Download className="w-4 h-4" /> Save to phone
            </button>
            <button onClick={discardHeld} className="text-sm px-3 py-2 rounded-lg text-red-700 dark:text-red-300">Discard</button>
          </div>
        </div>
      )}

      {!failed && recovered && (
        <div className="mb-3 rounded-xl border-2 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-100 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            Unsaved {recovered.mime.startsWith("video") ? "video" : "photo"} from {new Date(recovered.at).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}
            {recovered.improvementId !== incidentId ? ` (taken for report #${recovered.improvementId})` : ""}
          </p>
          <p className="text-xs text-amber-800/90 dark:text-amber-200/90">It never finished uploading — it's still safe on this device.</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => upload.mutate(stashAsFile(recovered))} disabled={uploading}
              className="text-sm px-3 py-2 rounded-lg bg-amber-600 text-white font-semibold flex items-center gap-1.5 disabled:opacity-50">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />} Add to this report
            </button>
            <button onClick={() => void saveFileToDevice(stashAsFile(recovered))}
              className="text-sm px-3 py-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-background font-semibold flex items-center gap-1.5">
              <Download className="w-4 h-4" /> Save to phone
            </button>
            <button onClick={discardHeld} className="text-sm px-3 py-2 rounded-lg text-amber-800 dark:text-amber-200">Discard</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      ) : live.length === 0 ? (
        <p className="text-sm text-muted-foreground">No photos yet — a photo of what was found is the best evidence the report can hold.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
          {live.map(a => <Thumb key={a.id} a={a} onOpen={() => setLightbox(a)} onRemove={() => askRemove(a)} removing={remove.isPending && remove.variables?.id === a.id} />)}
        </div>
      )}

      {removed.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowRemoved(v => !v)} className="text-xs font-semibold text-muted-foreground inline-flex items-center gap-1 py-1">
            {showRemoved ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {removed.length} removed — kept on record
          </button>
          {showRemoved && (
            <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
              {removed.map(a => <Thumb key={a.id} a={a} onOpen={() => setLightbox(a)} />)}
            </div>
          )}
        </div>
      )}

      {lightbox && <Lightbox a={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function Provenance({ a }: { a: IncidentAttachment }) {
  return (
    <div className="px-2 py-1.5 text-[11px] leading-tight text-muted-foreground space-y-0.5">
      <p className="truncate">{a.uploadedByName ?? "Unknown"} · {format(new Date(a.createdAt), "d MMM HH:mm")}</p>
      {a.addedAfterSigning && (
        <p className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-300">
          <PenLine className="w-3 h-3" /> Added after signing
        </p>
      )}
      {a.deletedAt && (
        <p className="text-red-700 dark:text-red-300">
          Removed by {a.deletedByName ?? "unknown"}, {format(new Date(a.deletedAt), "d MMM HH:mm")}
          {a.deleteReason ? ` — ${a.deleteReason}` : ""}
        </p>
      )}
    </div>
  );
}

function Thumb({ a, onOpen, onRemove, removing }: { a: IncidentAttachment; onOpen: () => void; onRemove?: () => void; removing?: boolean }) {
  return (
    <div className={cn("relative rounded-xl border-2 border-border bg-card overflow-hidden", a.deletedAt && "opacity-60")}>
      <button onClick={onOpen} className="block w-full aspect-square bg-black/5" title={a.kind === "video" ? "Play video" : "View photo"}>
        {a.kind === "video" ? (
          <span className="w-full h-full bg-black flex items-center justify-center text-white"><Play className="w-8 h-8" /></span>
        ) : (
          <img src={incidentAttachmentUrl(a.id)} alt="" className="w-full h-full object-cover" loading="lazy" />
        )}
      </button>
      <Provenance a={a} />
      {/* Always visible — hover-only controls don't exist on an iPad. */}
      {onRemove && (
        <button
          onClick={onRemove}
          disabled={removing}
          className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-2 shadow-md active:scale-95 transition-transform disabled:opacity-60"
          title="Remove from the report"
          aria-label="Remove this photo or video from the report"
        >
          {removing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        </button>
      )}
    </div>
  );
}

/** Full-size viewer — X button, tap outside, or Escape closes it. */
function Lightbox({ a, onClose }: { a: IncidentAttachment; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[200] bg-black/85 flex flex-col items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true">
      <button onClick={onClose} className="absolute top-4 right-4 text-white bg-black/40 rounded-full p-2" title="Close" aria-label="Close">
        <X className="w-8 h-8" />
      </button>
      {a.kind === "video" ? (
        <video src={incidentAttachmentUrl(a.id)} controls autoPlay playsInline className="max-w-full max-h-[85dvh] rounded-lg bg-black" onClick={e => e.stopPropagation()} />
      ) : (
        <img src={incidentAttachmentUrl(a.id)} alt="" className="max-w-full max-h-[85dvh] rounded-lg" onClick={e => e.stopPropagation()} />
      )}
      <p className="mt-3 text-sm text-white/85 text-center" onClick={e => e.stopPropagation()}>
        {a.uploadedByName ?? "Unknown"} · {format(new Date(a.createdAt), "d MMM yyyy HH:mm")}
        {a.addedAfterSigning ? " · Added after signing" : ""}
        {a.deletedAt ? ` · Removed by ${a.deletedByName ?? "unknown"}${a.deleteReason ? ` (${a.deleteReason})` : ""}` : ""}
      </p>
    </div>
  );
}
