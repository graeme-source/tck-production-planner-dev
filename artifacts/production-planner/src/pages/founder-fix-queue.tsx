/**
 * Founder — Fix queue (docs/ISSUE_PIPELINE.md, 2026-09-24).
 *
 * A scheduled Claude Code session reviews every app issue the team reports
 * in the Andon log and writes back a recommendation: which lane it's in, is
 * it really a problem, why, and what would change. This page is where
 * Graeme says yes or no. Nothing gets built without his approval; approved
 * items are fixed on review branches, and after he deploys, the reporter
 * gets a "your report has been fixed — please test it" pop-up.
 *
 * Founder account only (same email gate as the rest of /founder; the API
 * enforces it too). Big cards, not a table — it's read on a phone or iPad.
 */
import { useEffect, useState } from "react";
import { Redirect } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, MessageSquareReply } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { PageHeader } from "@/components/page-header";
import { ImprovementSuggestions, useNoAction } from "@/components/fix-queue-extras";
import { FixQueueSearch, useFixQueueUnread } from "@/components/fix-queue-conversation";
import { FixCard, SNOOZE_OPTIONS, type DecisionAction } from "@/components/fix-queue-card";
import { FixQueueBuildNow } from "@/components/fix-queue-build-now";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  tabCount, unreadLabel, withMessageSent, withReplySent,
  type FixQueueItem, type FixQueueResponse, type FixQueueTab, type TriageStatus,
} from "@/lib/issue-pipeline";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";

const TABS: Array<{ key: FixQueueTab; label: string }> = [
  { key: "proposed", label: "To review" },
  { key: "in_progress", label: "In progress" },
  { key: "snoozed", label: "Snoozed" },
  { key: "approved", label: "Approved" },
  { key: "fixed", label: "Done" },
  { key: "rejected", label: "Rejected" },
  // "Dismiss — no action" (2026-10-10): kept, restorable, never messaged.
  { key: "no_action", label: "Dismissed" },
];

const TAB_HINTS: Partial<Record<FixQueueTab, string>> = {
  in_progress: "Waiting on Claude's answer to your reply, or being fixed. They come back to To review by themselves once Claude answers.",
  snoozed: "Out of sight until the date shown, then back in To review by themselves.",
  no_action: "Dismissed with no action — nobody was messaged and Claude won't pick them up again. Restore one to put it back.",
};

async function jsonOrThrow(res: Response) {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data;
}

const ACTION_TO_STATUS: Record<Exclude<DecisionAction, "reply">, TriageStatus> = { approve: "approved", reject: "rejected" };

// ── Page ────────────────────────────────────────────────────────────────────

export default function FounderFixQueue() {
  const { state } = useAuth();
  const meId = state.status === "authenticated" ? state.user.id : null;
  const isFounder = state.status === "authenticated" && state.user.email === FOUNDER_EMAIL;
  const [tab, setTab] = useState<FixQueueTab>("proposed");
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  // Cards Graeme has just replied to from this tab: kept on screen (with the
  // "Sent" state) after the refetch files them under In progress, so the
  // card he was looking at doesn't vanish. Cleared when he changes tab.
  const [sentItems, setSentItems] = useState<Map<number, FixQueueItem>>(new Map());
  // Find a card across every tab (2026-10-13). Typed text settles for a
  // moment before it's searched.
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const qc = useQueryClient();
  const queryKey = ["issue-pipeline", "review", q ? "search" : tab, q, meId] as const;

  const { data, isLoading, error } = useQuery<FixQueueResponse>({
    queryKey,
    queryFn: () => fetch(`${BASE}/api/issue-pipeline/review?${new URLSearchParams(q ? { q } : { tab })}`, { credentials: "include" }).then(jsonOrThrow),
    enabled: isFounder,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const decide = useMutation({
    mutationFn: async ({ id, action, note, fixNow }: { id: number; action: DecisionAction; note?: string; fixNow?: boolean }) =>
      fetch(`${BASE}/api/issue-pipeline/review/${id}/${action}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(note ? { note, ...(fixNow ? { fixNow: true } : {}) } : {}),
      }).then(jsonOrThrow),
    // Optimistic: the card leaves this tab (or picks up its reply flag) the
    // moment Graeme taps; the server's answer confirms or rolls it back.
    onMutate: async ({ id, action, note, fixNow }) => {
      setSavingIds(s => new Set(s).add(id));
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<FixQueueResponse>(queryKey);
      if (previous) {
        const item = previous.items.find(i => i.triage.id === id);
        if (item) {
          const counts = { ...previous.counts };
          let items = previous.items;
          if (action === "reply") {
            // Now waiting on Claude. The card stays where Graeme is looking,
            // showing "Sent — Claude will look at this on its next pass"
            // (the server files it under In progress; sentItems keeps it on
            // screen here until he changes tab).
            const sent = withReplySent(item, note ?? "", new Date(), fixNow);
            items = items.map(i => (i.triage.id === id ? sent : i));
            setSentItems(m => new Map(m).set(id, sent));
            if (!fixNow && !item.triage.awaitingRetriage) counts.awaitingReply += 1;
          } else {
            const to = ACTION_TO_STATUS[action];
            items = items.filter(i => i.triage.id !== id);
            counts[item.triage.status] = Math.max(0, counts[item.triage.status] - 1);
            counts[to] += 1;
          }
          qc.setQueryData<FixQueueResponse>(queryKey, { ...previous, items, counts });
        }
      }
      return { previous };
    },
    onError: (err: Error, { id, action }, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
      if (action === "reply") setSentItems(m => { const n = new Map(m); n.delete(id); return n; });
      toast({ title: action === "reply" ? "Not sent to Claude" : "Not saved", description: err.message, variant: "destructive" });
    },
    onSuccess: (_data, { action, fixNow }) => {
      toast(action === "reply" && fixNow
        ? { title: "Sent and approved — Claude will fix it your way", description: "It builds this on its next hourly run, then it waits for you to say deploy." }
        : {
          title: action === "approve" ? "Approved — saved" : action === "reject" ? "Rejected — saved" : "Sent — Claude will look at this on its next pass",
          description: action === "approve"
            ? "It joins the fix queue. Nothing ships until you deploy."
            : action === "reply" ? "It waits under In progress until Claude has answered, then comes back to To review." : undefined,
        });
    },
    onSettled: (_d, _e, { id }) => {
      setSavingIds(s => { const n = new Set(s); n.delete(id); return n; });
      void qc.invalidateQueries({ queryKey: ["issue-pipeline", "review"] });
    },
  });

  const sendMessage = useMutation({
    mutationFn: async ({ id, message, close }: { id: number; message: string; close: boolean }) =>
      fetch(`${BASE}/api/issue-pipeline/review/${id}/message`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, close }),
      }).then(jsonOrThrow),
    // Optimistic: the card shows the message (and "Waiting for <name>'s
    // reply") straight away and stays on screen — even "Send and close",
    // which the server files under Done, stays here until you change tab.
    onMutate: async ({ id, message, close }) => {
      setSavingIds(s => new Set(s).add(id));
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<FixQueueResponse>(queryKey);
      const item = previous?.items.find(i => i.triage.id === id);
      if (previous && item) {
        const sent = withMessageSent(item, message, close);
        qc.setQueryData<FixQueueResponse>(queryKey, { ...previous, items: previous.items.map(i => (i.triage.id === id ? sent : i)) });
        setSentItems(m => new Map(m).set(id, sent));
      }
      return { previous };
    },
    onSuccess: (_d, { close }) => toast({
      title: close ? "Sent — report closed" : "Message sent — the card stays here",
      description: close
        ? "It pops up for them next time they use the app. The card is now under Done."
        : "It pops up for them next time they use the app. Their answer brings the card back to To review.",
    }),
    onError: (err: Error, { id }, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
      setSentItems(m => { const n = new Map(m); n.delete(id); return n; });
      toast({ title: "Not sent", description: err.message, variant: "destructive" });
    },
    onSettled: (_d, _e, { id }) => {
      setSavingIds(s => { const n = new Set(s); n.delete(id); return n; });
      void qc.invalidateQueries({ queryKey: ["issue-pipeline", "review"] });
      void qc.invalidateQueries({ queryKey: ["issue-pipeline", "unread"] });
    },
  });

  const snooze = useMutation({
    mutationFn: async ({ id, days }: { id: number; days: number | null }) =>
      fetch(`${BASE}/api/issue-pipeline/review/${id}/${days == null ? "unsnooze" : "snooze"}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(days == null ? {} : { days }),
      }).then(jsonOrThrow),
    onMutate: async ({ id }) => {
      setSavingIds(s => new Set(s).add(id));
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<FixQueueResponse>(queryKey);
      if (previous) qc.setQueryData<FixQueueResponse>(queryKey, { ...previous, items: previous.items.filter(i => i.triage.id !== id) });
      return { previous };
    },
    onError: (err: Error, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
      toast({ title: "Not saved", description: err.message, variant: "destructive" });
    },
    onSuccess: (_d, { days }) => toast({
      title: days == null ? "Back in To review" : `Snoozed for ${SNOOZE_OPTIONS.find(o => o.days === days)?.label ?? `${days} days`}`,
      description: days == null ? undefined : "It comes back to To review by itself.",
    }),
    onSettled: (_d, _e, { id }) => {
      setSavingIds(s => { const n = new Set(s); n.delete(id); return n; });
      void qc.invalidateQueries({ queryKey: ["issue-pipeline", "review"] });
    },
  });

  const dismiss = useMutation({
    mutationFn: async ({ id }: { id: number }) =>
      fetch(`${BASE}/api/issue-pipeline/review/${id}/dismiss`, { method: "POST", credentials: "include" }).then(jsonOrThrow),
    // Optimistic: the card leaves the list the moment he taps.
    onMutate: async ({ id }) => {
      setSavingIds(s => new Set(s).add(id));
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<FixQueueResponse>(queryKey);
      if (previous) {
        const item = previous.items.find(i => i.triage.id === id);
        if (item) {
          const counts = { ...previous.counts };
          counts[item.triage.status] = Math.max(0, counts[item.triage.status] - 1);
          counts.dismissed = (counts.dismissed ?? 0) + 1;
          qc.setQueryData<FixQueueResponse>(queryKey, { ...previous, counts, items: previous.items.filter(i => i.triage.id !== id) });
        }
      }
      return { previous };
    },
    onError: (err: Error, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
      toast({ title: "Not dismissed", description: err.message, variant: "destructive" });
    },
    onSuccess: (data: { notified?: boolean }) => toast({
      title: "Dismissed — off the issue log",
      description: data?.notified ? "The reporter gets a note saying it's done." : undefined,
    }),
    onSettled: (_d, _e, { id }) => {
      setSavingIds(s => { const n = new Set(s); n.delete(id); return n; });
      void qc.invalidateQueries({ queryKey: ["issue-pipeline", "review"] });
    },
  });

  const noAction = useNoAction();
  // Replies from reporters you haven't read, on any tab (21 Oct 2026).
  const unread = useFixQueueUnread(isFounder);
  const unreadElsewhere = (unread.data?.items ?? []).filter(u => !(data?.items ?? []).some(i => i.triage.id === u.triageId));

  if (state.status === "authenticated" && !isFounder) return <Redirect to="/" />;
  if (state.status !== "authenticated") return null;

  const items = data?.items ?? [];
  const saving = savingIds.size > 0;
  // Just-replied cards the server has moved to In progress stay at the top
  // here, showing "Sent — Claude will look at this on its next pass".
  // Search results are exactly what matched, wherever each card is now.
  const listedIds = new Set(items.map(i => i.triage.id));
  const needsYou = q ? items : [...[...sentItems.values()].filter(s => !listedIds.has(s.triage.id)), ...items];
  const changeTab = (next: FixQueueTab) => { setSentItems(new Map()); setSearch(""); setQ(""); setTab(next); };

  return (
    <div className="space-y-3">
      {/* Its own line in the sidebar since 2026-09-29 (/fix-queue) — no
          longer a tab of The Business. Founder account only, as before. */}
      <PageHeader
        title="Fix queue"
        description="Claude reviews every app issue the team reports and recommends what to do. Nothing gets built without your approval."
      />

      {/* Build every approved card now, and find a card in ANY tab. */}
      <div className="grid gap-2 lg:grid-cols-[auto_minmax(0,1fr)] items-center">
        <FixQueueBuildNow />
        <FixQueueSearch value={search} onChange={setSearch} />
      </div>

      {/* New replies on cards that aren't in this list — one tap finds each. */}
      {unreadElsewhere.length > 0 && (
        <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 p-4 flex flex-wrap items-center gap-2">
          <MessageSquareReply className="w-6 h-6 text-emerald-700 dark:text-emerald-300" />
          <p className="font-bold text-emerald-900 dark:text-emerald-200 mr-1">New replies on other tabs:</p>
          {unreadElsewhere.map(u => (
            <button key={u.triageId} onClick={() => setSearch(String(u.andonIssueId))}
              className="h-11 px-4 rounded-xl bg-emerald-700 text-white font-bold hover:bg-emerald-800">
              {unreadLabel(u.reporterName?.split(" ")[0] ?? "Reporter", u.count)} · #{u.andonIssueId}
            </button>
          ))}
        </div>
      )}

      {/* Status tabs with counts */}
      <div role="tablist" aria-label="Fix queue" className="flex flex-wrap gap-1.5">
        {TABS.map(t => {
          const n = tabCount(data, t.key);
          const active = !q && t.key === tab;
          return (
            <button key={t.key} role="tab" aria-selected={active} onClick={() => changeTab(t.key)}
              className={cn(
                "h-11 px-3.5 rounded-xl border-2 font-semibold flex items-center gap-2 transition-colors",
                active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-secondary/50",
              )}>
              {t.label}
              <span className={cn("rounded-full px-2 text-xs font-bold tabular-nums", active ? "bg-white/25" : "bg-secondary")}>{n}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground min-h-5" aria-live="polite">
        {saving
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving your decision…</>
          : decide.isSuccess
            ? <><CheckCircle2 className="w-4 h-4 text-emerald-600" /> All decisions saved</>
            : q
              ? (isLoading ? "Searching every tab…" : `${items.length === 50 ? "First 50" : items.length} card${items.length === 1 ? "" : "s"} matching “${q}” across every tab`)
              : TAB_HINTS[tab] ?? null}
      </div>

      {/* Ideas from the improvements board that look like app changes —
          suggestions only, Graeme adds or dismisses each one. */}
      {!q && tab === "proposed" && <ImprovementSuggestions status="suggested" />}
      {!q && tab === "no_action" && <ImprovementSuggestions status="dismissed" />}

      {isLoading && <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}
      {error != null && (
        <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive">
          <AlertTriangle className="w-5 h-5" />
          <p className="text-sm">{(error as Error).message}</p>
        </div>
      )}
      {!isLoading && !error && needsYou.length === 0 && (
        <div className="rounded-3xl border-2 border-dashed border-border p-10 text-center text-muted-foreground">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-600" />
          <p className="text-lg font-semibold text-foreground">{q ? "No card matches" : "Nothing here"}</p>
          <p className="text-sm mt-1">
            {q
              ? "Try the issue number, the reporter's first name, or a word from their report."
              : tab === "proposed"
              ? ((data?.tabCounts?.in_progress ?? 0) > 0
                ? "Nothing needs you right now — the rest are waiting on Claude (see In progress)."
                : "No recommendations waiting for you. New ones appear as Claude reviews the issue log.")
              : "No items in this list."}
          </p>
        </div>
      )}

      <div className="space-y-4">
        {needsYou.map(item => (
          <FixCard
            key={item.triage.id}
            item={item}
            showTab={!!q}
            saving={savingIds.has(item.triage.id)}
            onDecide={(action, note, fixNow) => decide.mutate({ id: item.triage.id, action, note, fixNow })}
            onMessage={(message, close) => sendMessage.mutate({ id: item.triage.id, message, close })}
            onDismiss={() => dismiss.mutate({ id: item.triage.id })}
            onSnooze={days => snooze.mutate({ id: item.triage.id, days })}
            onNoAction={restore => noAction.mutate({ id: item.triage.id, restore })}
          />
        ))}
      </div>

    </div>
  );
}
