// Change an idea into an improvement by hand, and sort its photos into
// before and after (Graeme, 27 Oct 2026; Objective E): "someone has uploaded
// an idea, but really it's an improvement. They've put two before photos
// when really it should be before and after."
//
// Managers and admins only (the endpoint enforces it). One big button on the
// improvement's own page opens a closable, viewport-fit pop-up: every photo
// as a big tile with a Before / After switch, and one Save with a visible
// saving / saved / error state. The rules (at least one after; an idea has
// no after) are decided by the server — planReclassify in @workspace/db —
// and the screen just shows what it said.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeftRight, CheckCircle2, Lightbulb, Loader2, Sparkles } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { improvementMediaUrl } from "@/components/improvement-feed-media";
import { threadKey } from "@/components/improvement-thread";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Role = "before" | "after";
type Kind = "improvement" | "idea";

interface Attachment {
  id: number;
  kind: string;
  phase: "before" | "after" | "stitched" | null;
}

export const improvementAttachmentsKey = (id: number) => ["improvement-attachments", id] as const;

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return (body as { error?: string })?.error || `Something went wrong (${res.status})`;
}

/** Where a stored photo sits today — no phase shows under Before, the same
 *  as the improvement page. */
const roleOf = (phase: Attachment["phase"]): Role => (phase === "after" ? "after" : "before");

export function ImprovementReclassifyButton({ item, onSaved }: {
  item: {
    id: number;
    title: string;
    stage: "todo" | "waiting" | "approved" | "sent_back";
    submittedByName: string | null;
    creditNames?: string | null;
  };
  /** After a save — the page reloads its own photo slots. */
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isIdea = item.stage === "todo";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "w-full min-h-14 py-3 px-4 rounded-2xl border-2 text-lg font-bold flex items-center justify-center gap-2 transition-colors",
          isIdea
            ? "border-emerald-500 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
            : "border-border hover:bg-secondary/50",
        )}
      >
        {isIdea ? <Sparkles className="w-5 h-5 shrink-0" /> : <ArrowLeftRight className="w-5 h-5 shrink-0" />}
        {isIdea ? "Change to an improvement" : "Sort photos, or change back to an idea"}
      </button>
      {open && <ReclassifyDialog item={item} onClose={() => setOpen(false)} onSaved={onSaved} />}
    </>
  );
}

function ReclassifyDialog({ item, onClose, onSaved }: {
  item: Parameters<typeof ImprovementReclassifyButton>[0]["item"];
  onClose: () => void;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const isIdea = item.stage === "todo";
  const [kind, setKind] = useState<Kind>("improvement");
  const [roles, setRoles] = useState<Record<number, Role>>({});

  const attachments = useQuery<Attachment[]>({
    queryKey: improvementAttachmentsKey(item.id),
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/improvements/${item.id}/attachments`, { credentials: "include" });
      if (!res.ok) throw new Error(await readError(res));
      return res.json();
    },
  });
  // The improvement's own photos only — the joined clip is rebuilt, never sorted.
  const photos = useMemo(() => (attachments.data ?? []).filter(a => a.phase !== "stitched"), [attachments.data]);

  // Start every tile where it is today. A background refetch never undoes
  // a choice already made — only photos not seen yet get their default.
  useEffect(() => {
    setRoles(prev => ({ ...Object.fromEntries(photos.map(p => [p.id, roleOf(p.phase)])), ...prev }));
  }, [photos]);

  const effectiveRole = (id: number): Role => (kind === "idea" ? "before" : roles[id] ?? "before");
  const afterCount = photos.filter(p => effectiveRole(p.id) === "after").length;
  const beforeCount = photos.length - afterCount;
  const blocker = kind === "improvement"
    ? photos.length === 0
      ? "There are no photos on this yet — add one on the page first."
      : afterCount === 0
        ? "Tap After on the photo that shows it fixed."
        : null
    : null;
  const nothingToDo = kind === "idea" && isIdea && photos.every(p => p.phase === "before");

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/improvements/${item.id}/reclassify`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          photos: kind === "improvement" ? photos.map(p => ({ id: p.id, role: effectiveRole(p.id) })) : undefined,
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      return res.json() as Promise<{ stageLabel: string; changed: boolean; removedCredit?: boolean }>;
    },
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ["improvements"] });
      void queryClient.invalidateQueries({ queryKey: improvementAttachmentsKey(item.id) });
      void queryClient.invalidateQueries({ queryKey: threadKey(item.id) });
      void queryClient.invalidateQueries({ queryKey: ["improvement-scoreboard"] });
      onSaved?.();
      toast({
        title: !r.changed
          ? "Nothing to change"
          : isIdea && kind === "improvement"
            ? "Now an improvement"
            : kind === "idea" && !isIdea
              ? "Back to an idea"
              : "Photos sorted",
        description: r.changed
          ? `${r.stageLabel}. ${r.removedCredit ? "It no longer counts on the Leaner-board." : ""}`.trim()
          : undefined,
      });
      onClose();
    },
  });

  const credited = item.creditNames || item.submittedByName || "whoever logged it";

  return (
    <Dialog open onOpenChange={o => { if (!o && !save.isPending) onClose(); }}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-3xl max-h-[92dvh] p-0 gap-0 flex flex-col rounded-2xl">
        <DialogHeader className="p-5 pb-3 border-b pr-12 text-left">
          <DialogTitle className="text-2xl">
            {isIdea ? "Change to an improvement" : "Sort photos"}
          </DialogTitle>
          <DialogDescription className="text-base break-words">{item.title}</DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto p-5 space-y-5 flex-1 min-h-0">
          {/* What it is. An idea → improvement is the main job; going back
              is there for mistakes. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <KindCard
              selected={kind === "improvement"}
              onClick={() => setKind("improvement")}
              icon={<Sparkles className="w-6 h-6" />}
              title="An improvement"
              text="It's been done — set which photo is before and which is after."
            />
            <KindCard
              selected={kind === "idea"}
              onClick={() => setKind("idea")}
              icon={<Lightbulb className="w-6 h-6" />}
              title="An idea"
              text="Not done yet — every photo is a before."
            />
          </div>

          {kind === "improvement" && isIdea && (
            <p className="text-base rounded-xl bg-secondary/60 p-3">
              It's credited to <strong>{credited}</strong>, exactly as if they'd added the after photo themselves.
            </p>
          )}
          {kind === "idea" && !isIdea && (
            <p className={cn(
              "text-base rounded-xl p-3 flex gap-2",
              item.stage === "approved" ? "bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 border border-amber-300" : "bg-secondary/60",
            )}>
              {item.stage === "approved" && <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />}
              <span>
                It goes back to "To do" and every photo becomes a before.
                {item.stage === "approved" && " It's approved now, so it will stop counting on the Leaner-board until it's finished again."}
              </span>
            </p>
          )}

          {attachments.isLoading && (
            <div className="flex items-center gap-3 text-muted-foreground text-lg py-8 justify-center">
              <Loader2 className="w-6 h-6 animate-spin" /> Loading the photos…
            </div>
          )}
          {attachments.isError && (
            <p className="rounded-xl bg-destructive/10 text-destructive p-3 font-semibold">
              Couldn't load the photos: {(attachments.error as Error).message}
            </p>
          )}

          {photos.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {photos.map(p => {
                const role = effectiveRole(p.id);
                return (
                  <div
                    key={p.id}
                    className={cn(
                      "rounded-2xl border-2 overflow-hidden bg-card",
                      role === "after" ? "border-emerald-500" : "border-amber-400",
                    )}
                  >
                    {p.kind === "video" ? (
                      <video
                        src={improvementMediaUrl(p.id)}
                        className="w-full aspect-[4/3] object-cover bg-black"
                        controls muted playsInline preload="metadata"
                      />
                    ) : (
                      <img
                        src={improvementMediaUrl(p.id)}
                        alt={role === "after" ? "After" : "Before"}
                        className="w-full aspect-[4/3] object-cover bg-muted"
                        loading="lazy"
                      />
                    )}
                    <div className="grid grid-cols-2 gap-2 p-2">
                      {(["before", "after"] as const).map(r => (
                        <button
                          key={r}
                          type="button"
                          disabled={kind === "idea" || save.isPending}
                          onClick={() => setRoles(prev => ({ ...prev, [p.id]: r }))}
                          aria-pressed={role === r}
                          className={cn(
                            "h-14 rounded-xl text-lg font-bold border-2 transition-colors disabled:cursor-not-allowed",
                            role === r
                              ? r === "after"
                                ? "bg-emerald-600 border-emerald-600 text-white"
                                : "bg-amber-400 border-amber-400 text-amber-950"
                              : "border-border text-muted-foreground hover:bg-secondary/60 disabled:opacity-50",
                          )}
                        >
                          {r === "before" ? "Before" : "After"}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Always reachable: the summary, the save state and the buttons. */}
        <div className="border-t p-4 space-y-3">
          <p className="text-base font-semibold">
            {beforeCount} before · {afterCount} after
          </p>
          {blocker && <p className="text-base text-amber-700 dark:text-amber-300 font-semibold">{blocker}</p>}
          {save.isError && (
            <p className="text-base text-destructive font-semibold flex gap-2">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" /> Not saved: {(save.error as Error).message}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={save.isPending}
              className="h-14 rounded-2xl border-2 border-border text-lg font-bold hover:bg-secondary/50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => save.mutate()}
              disabled={save.isPending || !!blocker || attachments.isLoading || attachments.isError || nothingToDo}
              className="h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {save.isPending
                ? <><Loader2 className="w-5 h-5 animate-spin" /> Saving…</>
                : <><CheckCircle2 className="w-5 h-5" /> Save</>}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function KindCard({ selected, onClick, icon, title, text }: {
  selected: boolean; onClick: () => void; icon: ReactNode; title: string; text: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "text-left rounded-2xl border-2 p-4 flex gap-3 items-start transition-colors",
        selected ? "border-primary bg-primary/10" : "border-border hover:bg-secondary/50",
      )}
    >
      <span className={cn("mt-0.5", selected ? "text-primary" : "text-muted-foreground")}>{icon}</span>
      <span>
        <span className="block text-xl font-bold">{title}</span>
        <span className="block text-base text-muted-foreground">{text}</span>
      </span>
    </button>
  );
}
