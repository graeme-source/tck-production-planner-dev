/**
 * Dismiss / Send to someone on the Timing data card (Graeme, 2026-10-15:
 * "Can you make it so I can dismiss these suggested cooking times? Or send
 * them to a certain person to review.").
 *
 * Dismiss = "the set time stands": the card hides until someone changes the
 * set value or the floor's suggestion moves well away, and can be brought
 * back from the "Dismissed" line. Send = a to-do (with a bell) on that
 * person's list, linking back here. Server: POST /api/timing-health/
 * dismiss | restore | send (rules in api-server lib/timing-review-rules.ts).
 */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { EyeOff, Loader2, Search, Send, UserRound, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePeople } from "@/components/messages/messages-api";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type TimingKind = "build" | "cook";
export interface SentInfo { assigneeName: string | null; by: string | null; at: string }

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${url}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || `Failed (${res.status})`);
  return json;
}

export function useTimingReview() {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: ["timing-health"] });
  const dismiss = useMutation({
    mutationFn: (b: { kind: TimingKind; targetId: number; setValue: number | null; suggestedValue: number | null }) => postJson("/api/timing-health/dismiss", b),
    onSuccess: done,
    onError: (e: Error) => toast({ title: "Not dismissed", description: e.message, variant: "destructive" }),
  });
  const restore = useMutation({
    mutationFn: (b: { kind: TimingKind; targetId: number }) => postJson("/api/timing-health/restore", b),
    onSuccess: done,
    onError: (e: Error) => toast({ title: "Not brought back", description: e.message, variant: "destructive" }),
  });
  return { dismiss, restore };
}

function dayLabel(at: string): string {
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
}

export function TimingReviewActions({ kind, targetId, name, setValue, suggestedValue, canDismiss, sent }: {
  kind: TimingKind;
  targetId: number;
  name: string;
  setValue: number | null;
  suggestedValue: number | null;
  /** Only a "set, but the floor says otherwise" card can be dismissed. */
  canDismiss: boolean;
  sent: SentInfo | null;
}) {
  const { dismiss } = useTimingReview();
  const [sending, setSending] = useState(false);
  return (
    <div className="pt-1 space-y-2">
      {sent && (
        <p className="text-xs font-semibold text-sky-800 dark:text-sky-200 bg-sky-50 dark:bg-sky-950/30 rounded-lg px-2.5 py-1.5 inline-flex items-center gap-1.5">
          <Send className="w-3.5 h-3.5" /> Sent to {sent.assigneeName ?? "someone"} to review · {dayLabel(sent.at)}{sent.by ? ` by ${sent.by}` : ""}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSending(true)}
          className="min-h-11 px-3 py-2 rounded-xl border border-border bg-card text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-secondary/60"
        >
          <Send className="w-4 h-4" /> {sent ? "Send to someone else" : "Send to someone to review"}
        </button>
        {canDismiss && (
          <button
            type="button"
            disabled={dismiss.isPending}
            onClick={() => dismiss.mutate({ kind, targetId, setValue, suggestedValue })}
            className="min-h-11 px-3 py-2 rounded-xl border border-border bg-card text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-secondary/60 disabled:opacity-50"
            title="Keep the set time. This comes back if someone changes it or the oven history moves well away."
          >
            {dismiss.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <EyeOff className="w-4 h-4" />} Dismiss — set time is right
          </button>
        )}
      </div>
      {sending && (
        <SendDialog
          kind={kind} targetId={targetId} name={name} setValue={setValue} suggestedValue={suggestedValue}
          onClose={() => setSending(false)}
        />
      )}
    </div>
  );
}

function SendDialog({ kind, targetId, name, setValue, suggestedValue, onClose }: {
  kind: TimingKind; targetId: number; name: string; setValue: number | null; suggestedValue: number | null; onClose: () => void;
}) {
  const qc = useQueryClient();
  const people = usePeople();
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const list = useMemo(() => {
    const words = q.trim().toLowerCase();
    return (people.data?.people ?? []).filter(p => !words || p.name.toLowerCase().includes(words));
  }, [people.data, q]);
  const send = useMutation({
    mutationFn: () => postJson("/api/timing-health/send", { kind, targetId, name, setValue, suggestedValue, assigneeId: pick, note: note.trim() || undefined }),
    onSuccess: () => {
      const who = people.data?.people.find(p => p.id === pick)?.name ?? "them";
      toast({ title: `Sent to ${who}`, description: "It's on their to-do list, with a bell." });
      void qc.invalidateQueries({ queryKey: ["timing-health"] });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Not sent", description: e.message, variant: "destructive" }),
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 md:p-8" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[92dvh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <Send className="w-5 h-5 text-primary" />
          <h2 className="font-display font-bold text-lg flex-1">Send to someone to review</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{name}</span> goes on their to-do list with a link back here, so they can use the suggested {kind === "build" ? "build" : "cook"} time, enter their own, or dismiss it.
          </p>
          <label className="relative block">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a person" autoFocus
              className="w-full h-11 pl-9 pr-3 rounded-xl border border-border bg-background text-base" />
          </label>
          {people.isLoading ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading the team…</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {list.map(p => (
                <button key={p.id} type="button" onClick={() => setPick(p.id)}
                  className={cn("min-h-12 px-3 py-2 rounded-xl border-2 text-left font-semibold flex items-center gap-2",
                    pick === p.id ? "border-primary bg-primary/10" : "border-border hover:bg-secondary/50")}>
                  {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover" /> : <UserRound className="w-6 h-6 text-muted-foreground" />}
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
              {list.length === 0 && <p className="text-sm text-muted-foreground">Nobody matches.</p>}
            </div>
          )}
          <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000}
            placeholder="Optional note, e.g. Time the next three trays and tell me"
            className="w-full min-h-[80px] px-3 py-2.5 bg-background border border-border rounded-xl text-base" />
        </div>
        <div className="p-5 pt-0 flex gap-2">
          <button onClick={onClose} className="flex-1 h-12 rounded-xl border border-border font-semibold hover:bg-secondary/60">Cancel</button>
          <button onClick={() => send.mutate()} disabled={pick == null || send.isPending}
            className="flex-1 h-12 rounded-xl bg-primary text-primary-foreground font-bold disabled:opacity-50 inline-flex items-center justify-center gap-2">
            {send.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Send
          </button>
        </div>
      </div>
    </div>
  );
}
