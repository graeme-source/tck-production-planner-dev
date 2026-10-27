/**
 * Comments & photos on an improvement — a timeline behind every card
 * (Graeme, 27 Oct 2026; Objective E): "make it so I can comment on
 * improvements and also post photos, like a bit of a timeline … put
 * comments and images behind a link that we can click and open, and we
 * can see visually if there's a comment or a link on there. Someone's asked
 * for something that's already possible, and I just want to reply to them."
 *
 *  - ImprovementThreadButton — on every card: "Comments & photos 💬 3 · 📷 2",
 *    or "Add a comment" when there's nothing yet.
 *  - ImprovementThreadPanel — the closable timeline: the original submission
 *    at the top, then comments and photos oldest first, each with who and
 *    when; tap a photo to see it big. A big box at the bottom to write, an
 *    "Add photo" button (camera or library on the iPad) and a visible
 *    Sending… / Sent ✓ / Couldn't send state. Your own comments (or any, for
 *    a manager) can be deleted.
 *
 * Whoever logged it, everyone credited on it and anyone already in the
 * conversation get a bell notification that opens this panel (server side:
 * routes/improvement-thread.ts).
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Camera, CheckCircle2, Lightbulb, Loader2, MessageSquare, Play, RotateCcw, Send, Trash2, X,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DictateButton } from "@/components/dictate-button";
import { feedTimestamp } from "@/lib/feed-time";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import {
  hasThread, sendStateLabel, threadCountsLabel, threadCountsSpoken,
  type SendState, type ThreadCounts,
} from "@/lib/improvement-thread";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const photoUrl = (id: number) => `${BASE}/api/improvements/attachments/${id}`;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

interface ThreadPhoto { id: number; kind: "image" | "video" }
type ThreadEntry =
  | { type: "submitted"; key: string; at: string; userName: string | null; title: string; description: string | null; photos: ThreadPhoto[] }
  | { type: "done"; key: string; at: string; names: string | null; photos: ThreadPhoto[] }
  | { type: "comment"; key: string; at: string; id: number; userId: number | null; userName: string | null; text: string; photos: ThreadPhoto[]; canDelete: boolean };
interface ThreadResponse { improvementId: number; title: string; entries: ThreadEntry[] }

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return body?.error || `The server said no (HTTP ${res.status}).`;
}

export const threadKey = (id: number) => ["improvement-thread", id] as const;

// ── The button on the card ──────────────────────────────────────────────────

export function ImprovementThreadButton({ counts, onOpen, size = "feed" }: {
  counts: ThreadCounts;
  onOpen: () => void;
  size?: "feed" | "detail";
}) {
  const any = hasThread(counts);
  const label = threadCountsLabel(counts);
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onOpen(); }}
      aria-label={threadCountsSpoken(counts)}
      className={cn(
        "w-full rounded-2xl border-2 font-bold flex items-center justify-center gap-2.5 transition-colors active:scale-[0.99]",
        size === "detail" ? "h-16 text-xl" : "h-14 text-lg",
        any
          ? "border-sky-500 bg-sky-50 text-sky-900 hover:bg-sky-100 dark:bg-sky-950/40 dark:text-sky-100 dark:hover:bg-sky-900/40"
          : "border-border text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
      )}
    >
      <MessageSquare className={cn(size === "detail" ? "w-6 h-6" : "w-5 h-5", any && "fill-sky-200 dark:fill-sky-800")} />
      {any ? (
        <>
          <span>Comments &amp; photos</span>
          <span className="rounded-full bg-sky-600 text-white px-3 py-0.5 text-base tabular-nums whitespace-nowrap">{label}</span>
        </>
      ) : (
        <span>Add a comment</span>
      )}
    </button>
  );
}

// ── The panel ───────────────────────────────────────────────────────────────

export function ImprovementThreadPanel({ improvementId, title, open, onClose }: {
  improvementId: number;
  /** Shown while the timeline loads. */
  title?: string;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { state } = useAuth();
  const meId = state.status === "authenticated" ? state.user.id : null;

  const thread = useQuery<ThreadResponse>({
    queryKey: threadKey(improvementId),
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/improvements/${improvementId}/thread`, { credentials: "include" });
      if (!res.ok) throw new Error(await readError(res));
      return res.json();
    },
    enabled: open,
    // Replies land while it's open — keep it fresh without a pull.
    refetchInterval: open ? 30_000 : false,
  });

  const [draft, setDraft] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [sendState, setSendState] = useState<SendState>("idle");
  const [sendError, setSendError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<ThreadPhoto | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const sentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!photo) { setPhotoPreview(null); return; }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  useEffect(() => () => { if (sentTimer.current) clearTimeout(sentTimer.current); }, []);

  // Newest at the bottom, like a chat — land there when it opens and after sending.
  const entryCount = thread.data?.entries.length ?? 0;
  useEffect(() => {
    if (open && entryCount > 0) endRef.current?.scrollIntoView({ block: "end" });
  }, [open, entryCount]);

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: threadKey(improvementId) });
    // The counts on the card.
    void queryClient.invalidateQueries({ queryKey: ["improvements"], exact: true });
  };

  const send = useMutation({
    mutationFn: async (v: { text: string; photo: File | null }) => {
      let res: Response;
      if (v.photo) {
        const form = new FormData();
        form.append("file", v.photo);
        if (v.text) form.append("comment", v.text);
        res = await fetch(`${BASE}/api/improvements/${improvementId}/comments/photo`, { method: "POST", credentials: "include", body: form });
      } else {
        res = await fetch(`${BASE}/api/improvements/${improvementId}/comments`, {
          method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comment: v.text }),
        });
      }
      if (!res.ok) throw new Error(await readError(res));
      return res.json();
    },
    onMutate: () => { setSendState("sending"); setSendError(null); },
    onSuccess: () => {
      setDraft("");
      setPhoto(null);
      setSendState("sent");
      if (sentTimer.current) clearTimeout(sentTimer.current);
      sentTimer.current = setTimeout(() => setSendState(s => (s === "sent" ? "idle" : s)), 2500);
      refreshAll();
    },
    // The words and the photo stay put, so nothing is lost — try again.
    onError: (e: Error) => {
      setSendState("failed");
      setSendError(e.message === "Failed to fetch"
        ? "It didn't reach the server — check the Wi-Fi and try again."
        : e.message);
    },
  });

  const remove = useMutation({
    mutationFn: async (commentId: number) => {
      const res = await fetch(`${BASE}/api/improvements/${improvementId}/comments/${commentId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error(await readError(res));
    },
    onSuccess: () => { setConfirmDelete(null); refreshAll(); },
    onError: (e: Error) => toast({ title: "Couldn't delete it", description: e.message, variant: "destructive" }),
  });

  const text = draft.trim();
  const canSend = (text.length > 0 || photo != null) && sendState !== "sending";
  const submit = () => { if (canSend) send.mutate({ text, photo }); };

  const pickPhoto = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setSendState("failed");
      setSendError("That isn't a photo — pick a picture from the camera or the library.");
      return;
    }
    if (f.size > MAX_PHOTO_BYTES) {
      setSendState("failed");
      setSendError("That photo is too big (max 10MB) — take it again or pick a smaller one.");
      return;
    }
    setPhoto(f);
    if (sendState === "failed") { setSendState("idle"); setSendError(null); }
  };

  const heading = thread.data?.title ?? title ?? "Improvement";

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent
        className={cn(
          "w-[calc(100vw-1.5rem)] sm:max-w-3xl h-[92dvh] max-h-[92dvh] p-0 gap-0 rounded-2xl overflow-hidden flex flex-col",
          // Our own big close button replaces the dialog's tiny one.
          "[&>button:last-child]:hidden",
        )}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-4 md:px-5 py-3 border-b border-border bg-secondary/40 flex-shrink-0">
          <MessageSquare className="w-7 h-7 text-sky-600 flex-shrink-0 mt-1" />
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-xl font-bold leading-snug break-words">{heading}</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">Comments &amp; photos · oldest first</DialogDescription>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-12 w-12 rounded-xl border-2 border-border bg-card flex items-center justify-center hover:bg-secondary flex-shrink-0"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* The timeline */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 md:px-5 py-4 space-y-3 bg-card">
          {thread.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-lg">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading…
            </div>
          ) : thread.isError ? (
            <div className="rounded-2xl border-2 border-destructive/40 bg-destructive/5 p-4 space-y-3">
              <p className="text-lg font-semibold text-destructive">Couldn't load the comments.</p>
              <p className="text-sm">{(thread.error as Error).message}</p>
              <button onClick={() => thread.refetch()} className="h-12 px-4 rounded-xl border-2 border-border font-bold flex items-center gap-2">
                <RotateCcw className="w-4 h-4" /> Try again
              </button>
            </div>
          ) : (
            <>
              {(thread.data?.entries ?? []).map(e => {
                if (e.type === "submitted") {
                  return (
                    <div key={e.key} className="rounded-2xl border-2 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4">
                      <p className="text-sm font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                        <Lightbulb className="w-4 h-4" /> Logged by {e.userName ?? "someone"}
                        <span className="font-normal text-muted-foreground"> · {feedTimestamp(e.at)}</span>
                      </p>
                      <p className="text-lg font-bold mt-1 break-words">{e.title}</p>
                      {e.description && e.description !== e.title && (
                        <p className="text-base mt-1 whitespace-pre-wrap break-words">{e.description}</p>
                      )}
                      <Thumbs photos={e.photos} onOpen={setLightbox} />
                    </div>
                  );
                }
                if (e.type === "done") {
                  return (
                    <div key={e.key} className="flex flex-col items-center gap-2">
                      <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-full px-4 py-1.5 flex items-center gap-1.5 text-center">
                        <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> Done{e.names ? ` — ${e.names}` : ""} · {feedTimestamp(e.at)}
                      </p>
                      {e.photos.length > 0 && <Thumbs photos={e.photos} onOpen={setLightbox} />}
                    </div>
                  );
                }
                const mine = meId != null && e.userId === meId;
                return (
                  <div key={e.key} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                    <div className={cn(
                      "max-w-[90%] md:max-w-[78%] rounded-2xl px-4 py-3 shadow-sm",
                      mine
                        ? "bg-primary/10 border-2 border-primary/30 rounded-br-md"
                        : "bg-secondary/60 border-2 border-border rounded-bl-md",
                    )}>
                      <p className="text-sm font-bold text-muted-foreground">
                        {mine ? "You" : (e.userName ?? "Someone")}
                        <span className="font-normal"> · {feedTimestamp(e.at)}</span>
                      </p>
                      {e.text && <p className="text-lg mt-0.5 whitespace-pre-wrap break-words">{e.text}</p>}
                      <Thumbs photos={e.photos} onOpen={setLightbox} large />
                      {e.canDelete && (
                        confirmDelete === e.id ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold">Delete this{e.photos.length > 0 ? " and its photo" : ""}?</span>
                            <button
                              onClick={() => remove.mutate(e.id)}
                              disabled={remove.isPending}
                              className="h-10 px-3 rounded-xl bg-destructive text-destructive-foreground text-sm font-bold flex items-center gap-1.5 disabled:opacity-50"
                            >
                              {remove.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Yes, delete
                            </button>
                            <button onClick={() => setConfirmDelete(null)} className="h-10 px-3 rounded-xl border-2 border-border text-sm font-bold">
                              Keep it
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(e.id)}
                            className="mt-1.5 text-sm text-muted-foreground hover:text-destructive flex items-center gap-1 h-9"
                          >
                            <Trash2 className="w-4 h-4" /> Delete
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
              {(thread.data?.entries.length ?? 0) <= 1 && (
                <p className="text-center text-base text-muted-foreground py-4">No comments yet — be the first.</p>
              )}
            </>
          )}
          <div ref={endRef} />
        </div>

        {/* Write a comment */}
        <div className="border-t-2 border-border bg-background px-3 md:px-5 py-3 space-y-2 flex-shrink-0">
          {photoPreview && (
            <div className="flex items-center gap-3">
              <img src={photoPreview} alt="Photo to send" className="w-20 h-20 rounded-xl object-cover border-2 border-border" />
              <button
                onClick={() => setPhoto(null)}
                disabled={sendState === "sending"}
                className="h-11 px-3 rounded-xl border-2 border-border text-sm font-bold flex items-center gap-1.5 disabled:opacity-50"
              >
                <X className="w-4 h-4" /> Remove photo
              </button>
            </div>
          )}
          <div className="flex items-start gap-2">
            <textarea
              value={draft}
              onChange={e => { setDraft(e.target.value); if (sendState === "sent") setSendState("idle"); }}
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
              rows={2}
              maxLength={4000}
              placeholder={photo ? "Say something about the photo (optional)…" : "Write a comment…"}
              aria-label="Your comment"
              className="flex-1 min-w-0 px-4 py-3 rounded-2xl border-2 border-border bg-card text-lg focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y min-h-[3.5rem] max-h-[30dvh]"
            />
            <DictateButton value={draft} onChange={setDraft} context="note" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* No `capture`, so the iPad offers both the camera and the library. */}
            <label className={cn(
              "h-14 px-4 rounded-2xl border-2 border-border bg-card text-lg font-bold flex items-center gap-2 cursor-pointer hover:bg-secondary/50",
              sendState === "sending" && "opacity-50 pointer-events-none",
            )}>
              <Camera className="w-5 h-5" /> {photo ? "Change photo" : "Add photo"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => { pickPhoto(e.target.files?.[0]); e.target.value = ""; }}
              />
            </label>
            <button
              onClick={submit}
              disabled={!canSend}
              className={cn(
                "flex-1 min-w-[10rem] h-14 rounded-2xl text-lg font-bold flex items-center justify-center gap-2 transition-colors",
                // "Sent ✓" stays bold even though the empty box can't send again.
                sendState !== "sent" && "disabled:opacity-50",
                sendState === "sent"
                  ? "bg-emerald-600 text-white"
                  : sendState === "failed"
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-primary text-primary-foreground",
              )}
            >
              {sendState === "sending" ? <Loader2 className="w-5 h-5 animate-spin" />
                : sendState === "sent" ? <CheckCircle2 className="w-5 h-5" />
                  : sendState === "failed" ? <RotateCcw className="w-5 h-5" />
                    : <Send className="w-5 h-5" />}
              {sendState === "failed" ? `${sendStateLabel("failed")} — try again` : sendStateLabel(sendState)}
            </button>
          </div>
          {sendState === "failed" && sendError && (
            <p role="alert" className="text-sm font-semibold text-destructive flex items-start gap-1.5">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {sendError} Your words{photo ? " and photo" : ""} are still here.
            </p>
          )}
        </div>

        {/* A photo, big — inside the panel so it's closable the same way. */}
        {lightbox && (
          <div
            className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
            onClick={() => setLightbox(null)}
          >
            <button
              type="button"
              onClick={() => setLightbox(null)}
              aria-label="Close photo"
              className="absolute top-3 right-3 h-12 w-12 rounded-xl bg-white/15 text-white flex items-center justify-center hover:bg-white/25"
            >
              <X className="w-7 h-7" />
            </button>
            {lightbox.kind === "video" ? (
              <video src={photoUrl(lightbox.id)} controls autoPlay playsInline className="max-w-full max-h-full rounded-lg bg-black" onClick={e => e.stopPropagation()} />
            ) : (
              <img src={photoUrl(lightbox.id)} alt="" className="w-full h-full object-contain" onClick={e => e.stopPropagation()} />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Thumbs({ photos, onOpen, large = false }: { photos: ThreadPhoto[]; onOpen: (p: ThreadPhoto) => void; large?: boolean }) {
  if (photos.length === 0) return null;
  const size = large ? "w-40 h-40" : "w-24 h-24";
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {photos.map(p => (
        <button key={p.id} type="button" onClick={() => onOpen(p)} title={p.kind === "video" ? "Play video" : "View photo"}>
          {p.kind === "video" ? (
            <span className={cn(size, "rounded-xl border-2 border-border bg-black text-white flex items-center justify-center")}>
              <Play className="w-8 h-8" />
            </span>
          ) : (
            <img src={photoUrl(p.id)} alt="" loading="lazy" className={cn(size, "rounded-xl object-cover border-2 border-border bg-black/5")} />
          )}
        </button>
      ))}
    </div>
  );
}
