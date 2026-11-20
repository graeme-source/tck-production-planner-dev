/**
 * Fix queue additions (Graeme, 2026-10-10; Objectives E and I), kept out of
 * the already-long pages/founder-fix-queue.tsx:
 *
 *  - NoActionButton / useNoAction — "Dismiss — no action": asks once ("No
 *    one will be messaged"), then the card leaves the queue silently. It's
 *    kept under Dismissed and can be restored. The hourly reviewer never
 *    picks it up again (server: isSetAside).
 *  - ImprovementSuggestions — "Suggested from improvements": ideas from the
 *    improvements board that read like a request to change the app. Graeme
 *    chooses Add to fix queue or Dismiss; nothing goes in without his click.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, ExternalLink, Lightbulb, Loader2, PlusCircle, RotateCcw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { feedTimestamp } from "@/lib/feed-time";
import { BoldText } from "@/components/bold-text";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function post<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/api/issue-pipeline/review/${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

/** "Dismiss — no action" with its one confirm, in place. */
export function NoActionButton({ onConfirm, saving, label = "Dismiss — no action" }: { onConfirm: () => void; saving: boolean; label?: string }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button onClick={() => setAsking(true)} disabled={saving}
        className="h-12 px-4 rounded-xl border-2 border-border font-bold flex items-center gap-2 hover:bg-secondary/60 disabled:opacity-50">
        <BellOff className="w-5 h-5" /> {label}
      </button>
    );
  }
  return (
    <div role="group" aria-label="Confirm dismiss" className="w-full rounded-2xl border-2 border-foreground/20 bg-secondary/50 p-3 flex flex-wrap items-center gap-2">
      <p className="text-base font-semibold flex-1 min-w-[12rem]">Dismiss this? No one will be messaged.</p>
      <button onClick={() => setAsking(false)} className="h-12 px-4 rounded-xl border-2 border-border bg-card font-bold">Cancel</button>
      <button onClick={() => { setAsking(false); onConfirm(); }} disabled={saving}
        className="h-12 px-4 rounded-xl bg-foreground text-background font-bold flex items-center gap-2 disabled:opacity-50">
        {saving && <Loader2 className="w-4 h-4 animate-spin" />} Yes, dismiss it
      </button>
    </div>
  );
}

/** Dismiss (no action) / restore a Fix queue card. */
export function useNoAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, restore }: { id: number; restore?: boolean }) => post(`${id}/${restore ? "restore" : "no-action"}`),
    onSuccess: (_d, { restore }) => toast({
      title: restore ? "Restored to the Fix queue" : "Dismissed — no one was messaged",
      description: restore ? undefined : "It's under Dismissed if you want it back.",
    }),
    onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["issue-pipeline", "review"] }),
  });
}

type Suggestion = {
  id: number;
  improvementId: number;
  reasons: string[];
  status: "suggested" | "dismissed";
  decidedBy: string | null;
  decidedAt: string | null;
  title: string;
  description: string | null;
  station: string;
  submittedByName: string | null;
  createdAt: string;
};

export function ImprovementSuggestions({ status }: { status: "suggested" | "dismissed" }) {
  const qc = useQueryClient();
  const key = ["issue-pipeline", "review", "suggestions", status] as const;
  const q = useQuery<{ items: Suggestion[] }>({
    queryKey: key,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/issue-pipeline/review/suggestions?status=${status}`, { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't load suggestions");
      return body;
    },
    refetchInterval: 5 * 60_000,
  });
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "add" | "dismiss" | "restore" }) => post<{ andonIssueId: number | null }>(`suggestions/${id}/${action}`),
    onSuccess: (d, { action }) => toast({
      title: action === "add" ? "Added to the Fix queue" : action === "dismiss" ? "Dismissed — no one was messaged" : "Back in Suggested",
      description: action === "add" ? `It's issue #${d.andonIssueId} now — Claude reviews it on the next run.` : undefined,
    }),
    onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["issue-pipeline", "review"] }),
  });

  const items = q.data?.items ?? [];
  if (q.isLoading || (items.length === 0 && !q.isError)) return null;

  return (
    <section className="space-y-3" aria-labelledby={`suggestions-${status}`}>
      <div className="flex items-center gap-2">
        <Lightbulb className="w-6 h-6 text-blue-500" />
        <h2 id={`suggestions-${status}`} className="text-xl font-bold">
          {status === "suggested" ? "Suggested from improvements" : "Dismissed suggestions"}
          <span className="ml-2 text-base font-semibold text-muted-foreground">{items.length}</span>
        </h2>
      </div>
      {status === "suggested" && (
        <p className="text-sm text-muted-foreground">Ideas from the improvements board that look like a change to the app. Nothing joins the queue unless you add it.</p>
      )}
      {q.isError && <p className="text-base font-semibold text-destructive">{(q.error as Error).message}</p>}
      <div className="space-y-3">
        {items.map(s => {
          const saving = decide.isPending && decide.variables?.id === s.id;
          return (
            <article key={s.id} className="rounded-3xl border-2 border-blue-200 dark:border-blue-900 bg-card p-5 space-y-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300">Improvement idea · {s.station}</p>
                <h3 className="text-lg font-bold leading-snug">{s.title}</h3>
                {s.description && s.description !== s.title && <p className="text-base text-muted-foreground line-clamp-3 whitespace-pre-wrap"><BoldText text={s.description} /></p>}
                <p className="text-sm text-muted-foreground mt-1">
                  Logged by {s.submittedByName ?? "someone"} · {feedTimestamp(s.createdAt)}
                  {s.status === "dismissed" && s.decidedBy ? ` · dismissed by ${s.decidedBy}${s.decidedAt ? ` ${feedTimestamp(s.decidedAt)}` : ""}` : ""}
                </p>
              </div>
              {s.reasons.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {s.reasons.map(r => <span key={r} className="px-2.5 py-1 rounded-full bg-secondary text-xs font-semibold">{r}</span>)}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border">
                {s.status === "suggested" ? (
                  <>
                    <button onClick={() => decide.mutate({ id: s.id, action: "add" })} disabled={saving}
                      className="h-12 px-4 rounded-xl bg-primary text-primary-foreground font-bold flex items-center gap-2 disabled:opacity-50">
                      {saving && decide.variables?.action === "add" ? <Loader2 className="w-5 h-5 animate-spin" /> : <PlusCircle className="w-5 h-5" />} Add to fix queue
                    </button>
                    <NoActionButton saving={saving} onConfirm={() => decide.mutate({ id: s.id, action: "dismiss" })} />
                  </>
                ) : (
                  <button onClick={() => decide.mutate({ id: s.id, action: "restore" })} disabled={saving}
                    className="h-12 px-4 rounded-xl border-2 border-border font-bold flex items-center gap-2 hover:bg-secondary/60 disabled:opacity-50">
                    <RotateCcw className="w-5 h-5" /> Restore
                  </button>
                )}
                <Link href={`/improvements?open=${s.improvementId}`}
                  className="ml-auto text-sm font-medium text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-2 py-2">
                  Open the idea <ExternalLink className="w-4 h-4" />
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

type JaneCheck = {
  id: number; userName: string | null; description: string; outcome: string; reply: string; path: string | null;
  matchedIssueId: number | null; result: string | null; filedIssueId: number | null; createdAt: string;
};

const CHECK_OUTCOME: Record<string, string> = { already_possible: "Already possible", already_reported: "Already reported", new: "New", sorted_in_chat: "Sorted with Jane, no report" };
const CHECK_RESULT: Record<string, string> = { resolved: "went to the page", followed: "keeping posted", reported: "reported it anyway" };

/** What AI Jane told people before their reports reached this queue, so an
 *  answer that stopped a report can still be seen and judged (2026-11-04). */
export function JaneChecks() {
  const q = useQuery<{ items: JaneCheck[] }>({
    queryKey: ["issue-pipeline", "jane-checks"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/issue-check/recent`, { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return res.json();
    },
    staleTime: 60_000,
  });
  const items = (q.data?.items ?? []).filter(c => c.outcome !== "new");
  if (items.length === 0) return null;
  return (
    <details className="rounded-2xl border-2 border-border bg-card px-4 py-3">
      <summary className="cursor-pointer font-bold">What AI Jane answered before it got here · {items.length}</summary>
      <div className="mt-3 space-y-2">
        {items.map(c => (
          <div key={c.id} className="rounded-xl bg-secondary/40 p-3 text-sm space-y-1">
            <p className="font-semibold whitespace-pre-wrap break-words">{c.description}</p>
            <p className="whitespace-pre-wrap break-words">{c.reply}</p>
            <p className="text-xs text-muted-foreground">
              {c.userName ?? "Someone"} · {feedTimestamp(c.createdAt)} · {CHECK_OUTCOME[c.outcome] ?? c.outcome}
              {c.matchedIssueId ? ` #${c.matchedIssueId}` : ""}{c.path ? ` ${c.path}` : ""}{c.outcome === "sorted_in_chat" ? "" : c.result ? ` · ${CHECK_RESULT[c.result] ?? c.result}` : " · no answer yet"}
            </p>
          </div>
        ))}
      </div>
    </details>
  );
}


type TalkChat = {
  id: number; userName: string | null; kind: "issue" | "idea"; andonIssueId: number | null; improvementId: number | null;
  original: string; transcript: Array<{ role: "user" | "assistant"; text: string }>; brief: string | null; createdAt: string;
};

/** AI Jane's questions before a report is filed (2026-11-19): the off
 *  switch, and the recent chats so how a report was worked out can be read. */
export function JaneTalkThroughPanel() {
  const qc = useQueryClient();
  const status = useQuery<{ available: boolean; switchOn: boolean }>({
    queryKey: ["report-chat", "status"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/report-chat/status`, { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return res.json();
    },
  });
  const chats = useQuery<{ items: TalkChat[] }>({
    queryKey: ["report-chat", "recent"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/report-chat/recent`, { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return res.json();
    },
    staleTime: 60_000,
  });
  const flip = useMutation({
    mutationFn: async (on: boolean) => {
      const res = await fetch(`${BASE}/api/report-chat/switch`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't change it");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["report-chat", "status"] }),
    onError: (e: Error) => toast({ title: "Couldn't change it", description: e.message, variant: "destructive" }),
  });
  const on = status.data?.switchOn ?? true;
  const items = chats.data?.items ?? [];
  return (
    <details className="rounded-2xl border-2 border-border bg-card px-4 py-3">
      <summary className="cursor-pointer font-bold flex items-center justify-between gap-3 flex-wrap">
        <span>AI Jane talks reports through · {on ? "On" : "Off"}{items.length ? ` · ${items.length} lately` : ""}</span>
        <span className="flex items-center gap-2 text-sm font-medium" onClick={e => e.preventDefault()}>
          {flip.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : flip.isSuccess ? <span className="text-emerald-600">Saved</span> : null}
          <button
            role="switch" aria-checked={on} disabled={status.isLoading || flip.isPending}
            onClick={() => flip.mutate(!on)}
            className={`h-9 px-4 rounded-xl border-2 font-bold ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary"}`}>
            {on ? "On" : "Off"}
          </button>
        </span>
      </summary>
      <p className="mt-2 text-sm text-muted-foreground">
        Managers have it, and anyone you give "AI Jane talks it through" in Team &amp; Access. Off means everyone reports as before.
      </p>
      <div className="mt-3 space-y-2">
        {items.length === 0 && <p className="text-sm text-muted-foreground">No chats yet.</p>}
        {items.map(c => (
          <div key={c.id} className="rounded-xl bg-secondary/40 p-3 text-sm space-y-1.5">
            <p className="text-xs text-muted-foreground">
              {c.userName ?? "Someone"} · {feedTimestamp(c.createdAt)} · {c.kind === "issue" ? `App report #${c.andonIssueId}` : `Idea #${c.improvementId}`}
            </p>
            <p className="font-semibold whitespace-pre-wrap break-words">{c.original}</p>
            {c.transcript.slice(1).map((t, i) => (
              <p key={i} className={`whitespace-pre-wrap break-words ${t.role === "assistant" ? "text-primary font-medium" : "pl-4"}`}>
                {t.role === "assistant" ? "Jane: " : "→ "}{t.text}
              </p>
            ))}
            {c.brief && <p className="rounded-lg bg-card p-2 whitespace-pre-wrap break-words">{c.brief}</p>}
          </div>
        ))}
      </div>
    </details>
  );
}
