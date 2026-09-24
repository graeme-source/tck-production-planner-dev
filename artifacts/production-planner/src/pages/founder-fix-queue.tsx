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
import { useState } from "react";
import { Link, Redirect } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, HelpCircle, Loader2,
  MessageCircleQuestion, OctagonAlert, Scale, Video, Wrench, X, XCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { PageHeader } from "@/components/page-header";
import { FounderNav } from "@/components/founder-nav";
import { MarkdownBlock } from "@/components/lesson-media";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { feedTimestamp } from "@/lib/feed-time";
import {
  LANE_LABELS, noticeStatusLine, tabCount,
  type FixQueueItem, type FixQueueResponse, type FixQueueTab, type TriageLane, type TriageStatus,
} from "@/lib/issue-pipeline";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";

const TABS: Array<{ key: FixQueueTab; label: string }> = [
  { key: "proposed", label: "To review" },
  { key: "approved", label: "Approved" },
  { key: "in_progress", label: "In progress" },
  { key: "fixed", label: "Fixed" },
  { key: "rejected", label: "Rejected" },
];

const LANE_STYLES: Record<TriageLane, string> = {
  defect: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200",
  data_fix: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200",
  understanding: "bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-200",
  improvement: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
  needs_info: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200",
  not_app: "bg-secondary text-muted-foreground",
};

const STATUS_LABELS: Record<TriageStatus, string> = {
  proposed: "To review", approved: "Approved", rejected: "Rejected",
  in_progress: "In progress", fixed: "Fixed", wont_fix: "Won't fix",
};

const SEVERITY_DOT: Record<string, string> = { red: "bg-red-500", yellow: "bg-amber-400", green: "bg-emerald-500" };

async function jsonOrThrow(res: Response) {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data;
}

type DecisionAction = "approve" | "reject" | "reply";
const ACTION_TO_STATUS: Record<Exclude<DecisionAction, "reply">, TriageStatus> = { approve: "approved", reject: "rejected" };

// ── Note dialog (reject with an optional note / reply with a question) ─────

function NoteDialog({ mode, onCancel, onSubmit }: {
  mode: "reject" | "reply";
  onCancel: () => void;
  onSubmit: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const isReply = mode === "reply";
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 md:p-8" onClick={onCancel}>
      <div
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          {isReply ? <MessageCircleQuestion className="w-5 h-5 text-sky-600" /> : <XCircle className="w-5 h-5 text-red-600" />}
          <h2 className="font-display font-bold text-lg flex-1">{isReply ? "Reply to Claude" : "Reject this recommendation"}</h2>
          <button onClick={onCancel} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <p className="text-sm text-muted-foreground">
            {isReply
              ? "Ask a question or add what Claude missed. It goes back for another look and returns here with an updated recommendation."
              : "Optional: say why, so the next recommendation for something similar is better."}
          </p>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            autoFocus
            maxLength={2000}
            placeholder={isReply ? "e.g. Which screen is this on? Check the building station on the iPad." : "e.g. Working as intended — it's a training point."}
            className="w-full min-h-[120px] px-3 py-2.5 bg-background border border-border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="p-5 pt-0 flex gap-2">
          <button onClick={onCancel} className="flex-1 h-12 rounded-xl border border-border font-semibold hover:bg-secondary/60">
            Cancel
          </button>
          <button
            onClick={() => onSubmit(note.trim())}
            disabled={isReply && !note.trim()}
            className={cn(
              "flex-1 h-12 rounded-xl font-bold disabled:opacity-50",
              isReply ? "bg-sky-600 text-white hover:bg-sky-700" : "bg-red-600 text-white hover:bg-red-700",
            )}
          >
            {isReply ? "Send to Claude" : "Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── One recommendation ──────────────────────────────────────────────────────

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold", className)}>{children}</span>;
}

function FixCard({ item, onDecide, saving }: {
  item: FixQueueItem;
  onDecide: (action: DecisionAction, note?: string) => void;
  saving: boolean;
}) {
  const { triage: t, issue } = item;
  const [whyOpen, setWhyOpen] = useState(false);
  const [dialog, setDialog] = useState<null | "reject" | "reply">(null);
  const status = t.status;
  const images = issue?.attachments.filter(a => a.kind === "image") ?? [];
  const videos = issue?.attachments.filter(a => a.kind !== "image") ?? [];

  return (
    <article className={cn("rounded-3xl border-2 border-border bg-card p-5 md:p-6 space-y-4 transition-opacity", saving && "opacity-60")}>
      {/* Chips */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip className={LANE_STYLES[t.lane]}>{LANE_LABELS[t.lane]}</Chip>
        {t.noGoZone && (
          <Chip className="bg-red-600 text-white"><OctagonAlert className="w-3.5 h-3.5" /> No-go zone — ships on its own</Chip>
        )}
        {t.behaviourChange && (
          <Chip className="bg-amber-500 text-white"><Scale className="w-3.5 h-3.5" /> Changes agreed behaviour — your call first</Chip>
        )}
        {t.awaitingRetriage && (
          <Chip className="bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200"><MessageCircleQuestion className="w-3.5 h-3.5" /> Waiting for Claude to reply</Chip>
        )}
        {status !== "proposed" && <Chip className="bg-secondary text-foreground">{STATUS_LABELS[status]}</Chip>}
        <span className="ml-auto text-xs text-muted-foreground">Issue #{t.andonIssueId} · triaged {feedTimestamp(t.triagedAt)}</span>
      </div>

      {/* Claude's question, up top where it can't be missed */}
      {t.questionForGraeme && (
        <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-4 flex gap-3">
          <HelpCircle className="w-6 h-6 text-amber-600 flex-shrink-0" />
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">Claude asks you</p>
            <p className="text-lg font-semibold whitespace-pre-wrap">{t.questionForGraeme}</p>
          </div>
        </div>
      )}

      {/* The reporter's own words */}
      {issue && (
        <div className="rounded-2xl bg-secondary/40 p-4 space-y-3">
          <blockquote className="text-lg md:text-xl leading-snug whitespace-pre-wrap border-l-4 border-primary pl-4">
            “{issue.description?.trim() || "(no description)"}”
          </blockquote>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{issue.reporter.name ?? "Someone"}</span>
            <span>{feedTimestamp(issue.createdAt)}</span>
            <span>{issue.station}</span>
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("w-2.5 h-2.5 rounded-full", SEVERITY_DOT[issue.severity] ?? "bg-muted")} />
              {issue.severity}
            </span>
            {issue.resolved && <span className="text-emerald-700 dark:text-emerald-400 font-medium">Resolved {feedTimestamp(issue.resolved.at)}</span>}
          </div>
          {issue.reportContext && <p className="text-sm text-muted-foreground">Context: {issue.reportContext}</p>}
          {(images.length > 0 || videos.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {images.map(a => (
                <a key={a.id} href={`${BASE}${a.url}`} target="_blank" rel="noopener noreferrer" className="block">
                  <img src={`${BASE}${a.url}`} alt={a.fileName ?? "Photo from the report"} loading="lazy"
                    className="w-24 h-24 md:w-28 md:h-28 object-cover rounded-xl border border-border" />
                </a>
              ))}
              {videos.map(a => (
                <a key={a.id} href={`${BASE}${a.url}`} target="_blank" rel="noopener noreferrer"
                  className="w-24 h-24 md:w-28 md:h-28 rounded-xl border border-border flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground hover:bg-secondary">
                  <Video className="w-6 h-6" /> Video
                </a>
              ))}
            </div>
          )}
          {issue.comments.length > 0 && (
            <p className="text-xs text-muted-foreground">{issue.comments.length} comment{issue.comments.length === 1 ? "" : "s"} on the issue</p>
          )}
        </div>
      )}

      {/* Verdict */}
      <p className="text-xl md:text-2xl font-bold leading-snug">{t.verdictSummary}</p>

      {/* Why — collapsible */}
      {t.explanation.trim() && (
        <div>
          <button onClick={() => setWhyOpen(o => !o)} className="flex items-center gap-2 text-base font-semibold text-muted-foreground hover:text-foreground">
            {whyOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />} Why
          </button>
          {whyOpen && (
            <div className="mt-2 pl-7 [&_div]:text-base [&_p]:whitespace-pre-wrap break-words">
              <MarkdownBlock content={t.explanation} />
            </div>
          )}
        </div>
      )}

      {/* Proposed fix */}
      {t.proposedFix.trim() && (
        <div className="rounded-2xl border border-border p-4">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">
            <Wrench className="w-4 h-4" /> Proposed fix
          </p>
          <p className="text-base whitespace-pre-wrap">{t.proposedFix}</p>
        </div>
      )}

      {/* Facts */}
      <div className="flex flex-wrap gap-2 text-sm">
        {t.objective && <Chip className="bg-primary/15 text-foreground">Objective {t.objective}</Chip>}
        <Chip className="bg-secondary text-foreground">Blast radius: {t.blastRadius}</Chip>
        <Chip className="bg-secondary text-foreground">Confidence: {t.confidence}</Chip>
        {t.causeTag && <Chip className="bg-secondary text-foreground">Cause: {t.causeTag}</Chip>}
      </div>

      {item.related.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Related reports</p>
          <div className="flex flex-col gap-1.5">
            {item.related.map(r => (
              <Link key={r.id} href={`/reports?tab=issues&issueId=${r.id}`}
                className="text-sm rounded-xl border border-border px-3 py-2 hover:bg-secondary/60 flex items-center gap-2">
                <span className="font-semibold">#{r.id}</span>
                <span className="truncate flex-1">{r.description ?? "—"}</span>
                {r.reporterName && <span className="text-muted-foreground hidden sm:inline">{r.reporterName}</span>}
                {r.resolvedAt && <Check className="w-4 h-4 text-emerald-600" />}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Decision / progress trail */}
      {(t.decidedAt || t.fixRef || item.notices.length > 0) && (
        <div className="space-y-1 text-sm text-muted-foreground border-t border-border pt-3">
          {t.decidedAt && (
            <p>
              {status === "proposed"
                ? (t.awaitingRetriage ? "You replied" : "You replied — Claude has updated the recommendation")
                : `${status === "rejected" ? "Rejected" : "Approved"} by ${t.decidedBy ?? "you"}`}
              {" · "}{feedTimestamp(t.decidedAt)}
              {t.decisionNote && <span className="block text-foreground">“{t.decisionNote}”</span>}
            </p>
          )}
          {t.fixRef && <p>Fix: <span className="font-mono text-foreground break-all">{t.fixRef}</span>{t.fixedAt ? ` · ${feedTimestamp(t.fixedAt)}` : ""}</p>}
          {status === "fixed" && !t.issueResolvedAt && <p className="text-amber-700 dark:text-amber-400 font-medium">Waiting for your deploy — the reporter is told once it's live.</p>}
          {item.notices.map(n => (
            <p key={n.id} className="flex items-center gap-1.5">
              <CheckCircle2 className={cn("w-4 h-4", n.acknowledgedAt ? "text-emerald-600" : "text-muted-foreground")} />
              {noticeStatusLine(n)}{n.andonIssueId !== t.andonIssueId ? ` (#${n.andonIssueId})` : ""}
              {" · "}{feedTimestamp(n.acknowledgedAt ?? n.createdAt)}
            </p>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {(status === "proposed" || status === "rejected") && (
          <button onClick={() => onDecide("approve")} disabled={saving}
            className="h-14 px-6 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center gap-2 hover:bg-primary/90 disabled:opacity-50 flex-1 sm:flex-none justify-center">
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
            {status === "rejected" ? "Approve after all" : "Approve"}
          </button>
        )}
        {(status === "proposed" || status === "approved") && (
          <button onClick={() => setDialog("reject")} disabled={saving}
            className="h-14 px-5 rounded-2xl border-2 border-red-300 dark:border-red-900 text-red-700 dark:text-red-300 font-bold flex items-center gap-2 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50">
            <XCircle className="w-5 h-5" /> Reject
          </button>
        )}
        {status === "proposed" && (
          <button onClick={() => setDialog("reply")} disabled={saving}
            className="h-14 px-5 rounded-2xl border-2 border-border font-bold flex items-center gap-2 hover:bg-secondary/60 disabled:opacity-50">
            <MessageCircleQuestion className="w-5 h-5" /> Reply / ask
          </button>
        )}
        <Link href={`/reports?tab=issues&issueId=${t.andonIssueId}`}
          className="ml-auto text-sm font-medium text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-2 py-2">
          Open in the issue log <ExternalLink className="w-4 h-4" />
        </Link>
      </div>

      {dialog && (
        <NoteDialog
          mode={dialog}
          onCancel={() => setDialog(null)}
          onSubmit={note => { setDialog(null); onDecide(dialog, note || undefined); }}
        />
      )}
    </article>
  );
}

/** A card Graeme has replied to, folded to one line: nothing for him to do
 *  until Claude answers, so it shouldn't look like it needs him. Tap to
 *  open the full card (e.g. to reject it while waiting). */
function WaitingRow({ item, onDecide, saving }: {
  item: FixQueueItem;
  onDecide: (action: DecisionAction, note?: string) => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { triage: t, issue } = item;
  if (open) {
    return (
      <div className="space-y-2">
        <button onClick={() => setOpen(false)} className="text-sm font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1.5">
          <ChevronDown className="w-4 h-4" /> Fold it back up
        </button>
        <FixCard item={item} onDecide={onDecide} saving={saving} />
      </div>
    );
  }
  return (
    <button
      onClick={() => setOpen(true)}
      className="w-full text-left rounded-2xl border border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/20 px-4 py-3 flex items-center gap-3 hover:bg-sky-50 dark:hover:bg-sky-950/40"
    >
      <MessageCircleQuestion className="w-5 h-5 text-sky-600 flex-shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold truncate">
          #{t.andonIssueId} · {issue?.description?.trim() || t.verdictSummary}
        </span>
        <span className="block text-xs text-muted-foreground truncate">
          You replied {t.decidedAt ? feedTimestamp(t.decidedAt) : ""}{t.decisionNote ? ` — “${t.decisionNote}”` : ""}
        </span>
      </span>
      <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
    </button>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function FounderFixQueue() {
  const { state } = useAuth();
  const meId = state.status === "authenticated" ? state.user.id : null;
  const isFounder = state.status === "authenticated" && state.user.email === FOUNDER_EMAIL;
  const [tab, setTab] = useState<FixQueueTab>("proposed");
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const qc = useQueryClient();
  const queryKey = ["issue-pipeline", "review", tab, meId] as const;

  const { data, isLoading, error } = useQuery<FixQueueResponse>({
    queryKey,
    queryFn: () => fetch(`${BASE}/api/issue-pipeline/review?tab=${tab}`, { credentials: "include" }).then(jsonOrThrow),
    enabled: isFounder,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const decide = useMutation({
    mutationFn: async ({ id, action, note }: { id: number; action: DecisionAction; note?: string }) =>
      fetch(`${BASE}/api/issue-pipeline/review/${id}/${action}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(note ? { note } : {}),
      }).then(jsonOrThrow),
    // Optimistic: the card leaves this tab (or picks up its reply flag) the
    // moment Graeme taps; the server's answer confirms or rolls it back.
    onMutate: async ({ id, action, note }) => {
      setSavingIds(s => new Set(s).add(id));
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<FixQueueResponse>(queryKey);
      if (previous) {
        const item = previous.items.find(i => i.triage.id === id);
        if (item) {
          const counts = { ...previous.counts };
          let items = previous.items;
          if (action === "reply") {
            items = items.map(i => i.triage.id === id
              ? { ...i, triage: { ...i.triage, awaitingRetriage: true, decisionNote: note ?? null, decidedAt: new Date().toISOString() } }
              : i);
            if (!item.triage.awaitingRetriage) counts.awaitingReply += 1;
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
    onError: (err: Error, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
      toast({ title: "Not saved", description: err.message, variant: "destructive" });
    },
    onSuccess: (_data, { action }) => {
      toast({
        title: action === "approve" ? "Approved — saved" : action === "reject" ? "Rejected — saved" : "Sent to Claude — saved",
        description: action === "approve" ? "It joins the fix queue. Nothing ships until you deploy." : undefined,
      });
    },
    onSettled: (_d, _e, { id }) => {
      setSavingIds(s => { const n = new Set(s); n.delete(id); return n; });
      void qc.invalidateQueries({ queryKey: ["issue-pipeline", "review"] });
    },
  });

  if (state.status === "authenticated" && !isFounder) return <Redirect to="/" />;
  if (state.status !== "authenticated") return null;

  const items = data?.items ?? [];
  const saving = savingIds.size > 0;
  // On To review, cards Graeme has replied to fold away below — they're
  // waiting on Claude, not him.
  const waitingOnClaude = tab === "proposed" ? items.filter(i => i.triage.awaitingRetriage) : [];
  const needsYou = tab === "proposed" ? items.filter(i => !i.triage.awaitingRetriage) : items;

  return (
    <div className="space-y-6 max-w-4xl">
      <FounderNav />
      <PageHeader
        title="Fix queue"
        description="Claude reviews every app issue the team reports and recommends what to do. Nothing gets built without your approval."
      />

      <p className="text-base text-muted-foreground">
        Claude reviews every app issue the team reports and recommends what to do.{" "}
        <span className="font-semibold text-foreground">Nothing gets built without your approval.</span>
      </p>

      {/* Status tabs with counts */}
      <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
        {TABS.map(t => {
          const n = tabCount(data?.counts, t.key);
          const active = t.key === tab;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn(
                "rounded-2xl border-2 px-3 py-3 text-left transition-colors min-w-0",
                active ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-secondary/50",
              )}>
              <span className="block text-2xl font-bold leading-none">{n}</span>
              <span className="block text-sm font-medium text-muted-foreground mt-1 truncate">{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground min-h-5" aria-live="polite">
        {saving
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving your decision…</>
          : decide.isSuccess
            ? <><CheckCircle2 className="w-4 h-4 text-emerald-600" /> All decisions saved</>
            : tab === "proposed" && (data?.counts.awaitingReply ?? 0) > 0
              ? <>{data!.counts.awaitingReply} waiting for Claude to answer your reply</>
              : null}
      </div>

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
          <p className="text-lg font-semibold text-foreground">Nothing here</p>
          <p className="text-sm mt-1">
            {tab === "proposed"
              ? (waitingOnClaude.length > 0 ? "Nothing needs you right now — the rest are waiting on Claude." : "No recommendations waiting for you. New ones appear as Claude reviews the issue log.")
              : "No items in this list."}
          </p>
        </div>
      )}

      <div className="space-y-5">
        {needsYou.map(item => (
          <FixCard
            key={item.triage.id}
            item={item}
            saving={savingIds.has(item.triage.id)}
            onDecide={(action, note) => decide.mutate({ id: item.triage.id, action, note })}
          />
        ))}
      </div>

      {waitingOnClaude.length > 0 && (
        <section className="space-y-2 pt-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Waiting for Claude — nothing for you to do ({waitingOnClaude.length})
          </h2>
          <p className="text-sm text-muted-foreground">
            You've replied to these. Claude picks replies up on its next review and the card comes back up top, updated.
          </p>
          <div className="space-y-2">
            {waitingOnClaude.map(item => (
              <WaitingRow
                key={item.triage.id}
                item={item}
                saving={savingIds.has(item.triage.id)}
                onDecide={(action, note) => decide.mutate({ id: item.triage.id, action, note })}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
