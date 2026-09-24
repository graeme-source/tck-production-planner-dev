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
  AlertTriangle, AlarmClock, Award, Check, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, HelpCircle, Loader2,
  MessageCircleQuestion, MessageSquareText, OctagonAlert, Scale, Send, Video, Wrench, X, XCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { PageHeader } from "@/components/page-header";
import { FounderNav } from "@/components/founder-nav";
import { MarkdownBlock } from "@/components/lesson-media";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { feedTimestamp } from "@/lib/feed-time";
import {
  LANE_LABELS, cardActions, noticeStatusLine, tabCount,
  type FixQueueItem, type FixQueueResponse, type FixQueueTab, type TriageLane, type TriageStatus,
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
];

const SNOOZE_OPTIONS: Array<{ days: number; label: string }> = [
  { days: 1, label: "1 day" }, { days: 3, label: "3 days" }, { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" }, { days: 30, label: "1 month" },
];

const TAB_HINTS: Partial<Record<FixQueueTab, string>> = {
  in_progress: "Waiting on Claude's answer to your reply, or being fixed. They come back to To review by themselves once Claude answers.",
  snoozed: "Out of sight until the date shown, then back in To review by themselves.",
};

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
  in_progress: "In progress", fixed: "Fixed", wont_fix: "Won't fix", answered: "Answered", dismissed: "Dismissed — already done",
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
          <h2 className="font-display font-bold text-lg flex-1">{isReply ? "Reply / ask Claude" : "Reject this recommendation"}</h2>
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

/** "Message the reporter": Graeme's own words to whoever reported it,
 *  pre-filled with Claude's suggested reply (step-by-step instructions when
 *  they can fix it themselves in the app). "This answers it" closes the
 *  report — the usual case when no code change is needed. */
function MessageDialog({ reporterName, suggested, canClose, onCancel, onSubmit }: {
  reporterName: string;
  suggested: string | null;
  canClose: boolean;
  onCancel: () => void;
  onSubmit: (message: string, close: boolean) => void;
}) {
  const [message, setMessage] = useState(suggested ?? "");
  const [close, setClose] = useState(canClose);
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 md:p-8" onClick={onCancel}>
      <div
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <MessageSquareText className="w-5 h-5 text-primary" />
          <h2 className="font-display font-bold text-lg flex-1">Message {reporterName}</h2>
          <button onClick={onCancel} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <p className="text-sm text-muted-foreground">
            {suggested
              ? "Claude drafted this — check it, change anything, then send. It pops up full-screen for them next time they use the app."
              : "Write to them directly. It pops up full-screen for them next time they use the app."}
          </p>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            autoFocus
            maxLength={4000}
            placeholder="e.g. No fix needed — you can set this yourself: open Product → Recipes, pick the recipe, and fill in the oven override."
            className="w-full min-h-[200px] px-3 py-2.5 bg-background border border-border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {canClose ? (
            <label className="flex items-start gap-3 rounded-xl border border-border p-3 cursor-pointer">
              <input type="checkbox" checked={close} onChange={e => setClose(e.target.checked)} className="mt-1 w-5 h-5 accent-[hsl(var(--primary))]" />
              <span>
                <span className="block font-semibold">This answers it — close the report</span>
                <span className="block text-sm text-muted-foreground">Untick to keep it open (e.g. you're asking them something).</span>
              </span>
            </label>
          ) : (
            <p className="text-sm text-muted-foreground">This report is already closed or being fixed, so the message won't change that.</p>
          )}
        </div>
        <div className="p-5 pt-0 flex gap-2">
          <button onClick={onCancel} className="flex-1 h-12 rounded-xl border border-border font-semibold hover:bg-secondary/60">
            Cancel
          </button>
          <button
            onClick={() => onSubmit(message.trim(), canClose && close)}
            disabled={!message.trim()}
            className="flex-1 h-12 rounded-xl bg-primary text-primary-foreground font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Send className="w-4 h-4" /> {canClose && close ? "Send & close" : "Send"}
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

function FixCard({ item, onDecide, onMessage, onDismiss, onSnooze, saving }: {
  item: FixQueueItem;
  onDecide: (action: DecisionAction, note?: string) => void;
  onMessage: (message: string, close: boolean) => void;
  onDismiss: () => void;
  /** days = null brings a snoozed card back now. */
  onSnooze: (days: number | null) => void;
  saving: boolean;
}) {
  const { triage: t, issue } = item;
  const [whyOpen, setWhyOpen] = useState(false);
  const [dialog, setDialog] = useState<null | "reject" | "reply" | "message">(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const snoozedUntil = t.snoozedUntil && new Date(t.snoozedUntil).getTime() > Date.now() ? new Date(t.snoozedUntil) : null;
  const actions = cardActions(t);
  const thread = item.thread ?? [];
  const firstName = issue?.reporter.name?.split(" ")[0] ?? "the reporter";
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
        {t.noActionNeeded && (status === "proposed" || status === "approved" || status === "rejected") && (
          <Chip className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"><CheckCircle2 className="w-3.5 h-3.5" /> Already done — no action needed</Chip>
        )}
        {snoozedUntil && status === "proposed" && (
          <Chip className="bg-secondary text-foreground"><AlarmClock className="w-3.5 h-3.5" /> Snoozed until {snoozedUntil.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</Chip>
        )}
        {t.awaitingRetriage && (
          <Chip className="bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200"><MessageCircleQuestion className="w-3.5 h-3.5" /> Waiting for Claude to reply</Chip>
        )}
        {status !== "proposed" && <Chip className="bg-secondary text-foreground">{STATUS_LABELS[status]}</Chip>}
        <span className="ml-auto text-xs text-muted-foreground">Issue #{t.andonIssueId} · triaged {feedTimestamp(t.triagedAt)}</span>
      </div>

      {/* Claude's question — the conversation to finish before there's a
          plan. Reply lives right here, on the thing it answers. */}
      {t.questionForGraeme && status === "proposed" && (
        <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3">
          <div className="flex gap-3">
            <HelpCircle className="w-6 h-6 text-amber-600 flex-shrink-0" />
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">Claude asks you</p>
              <p className="text-lg font-semibold whitespace-pre-wrap">{t.questionForGraeme}</p>
            </div>
          </div>
          {actions.canReply && (
            <button onClick={() => setDialog("reply")} disabled={saving}
              className="h-12 px-5 rounded-xl bg-amber-500 text-white font-bold flex items-center gap-2 hover:bg-amber-600 disabled:opacity-50">
              <MessageCircleQuestion className="w-5 h-5" /> Answer Claude
            </button>
          )}
        </div>
      )}
      {actions.waitingOnClaude && (
        <div className="rounded-2xl border-2 border-sky-300 bg-sky-50 dark:bg-sky-950/30 p-4 flex gap-3">
          <MessageCircleQuestion className="w-6 h-6 text-sky-600 flex-shrink-0" />
          <p className="text-base"><span className="font-bold">You replied — Claude is working on it.</span> The card comes back to To review once it has answered. Nothing for you to do yet.</p>
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

      {/* The back-and-forth so far — only worth showing once there's more
          than Claude's first word. */}
      {thread.length > 1 && (
        <div className="rounded-2xl border border-border p-4 space-y-2.5">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Conversation</p>
          {thread.map((m, i) => (
            <div key={i} className={cn("flex", m.who === "claude" ? "justify-start" : "justify-end")}>
              <div className={cn(
                "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm",
                m.who === "claude" ? "bg-secondary/60" : m.who === "reporter" ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-primary/10",
              )}>
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  {m.who === "claude" ? (m.kind === "question" ? "Claude asked" : "Claude") : m.who === "reporter" ? issue?.reporter.name ?? "Reporter" : m.kind === "message" ? `You → ${issue?.reporter.name?.split(" ")[0] ?? "reporter"}` : "You"}
                  {" · "}{feedTimestamp(m.at)}
                </p>
                <p className="whitespace-pre-wrap">{m.text}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Proposed fix — Approve / Dismiss live here, on what they act on.
          Held back while there's still a conversation to finish. */}
      {(t.proposedFix.trim() || actions.canApprove || actions.canDismiss || actions.approveBlocked) && (
        <div className="rounded-2xl border border-border p-4 space-y-3">
          {t.proposedFix.trim() && (
            <div>
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">
                <Wrench className="w-4 h-4" /> Proposed fix
              </p>
              <p className="text-base whitespace-pre-wrap">{t.proposedFix}</p>
            </div>
          )}
          {actions.canDismiss && (
            <div className="space-y-1.5">
              <button onClick={onDismiss} disabled={saving}
                className="h-14 px-6 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center gap-2 hover:bg-primary/90 disabled:opacity-50">
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                Dismiss — already done
              </button>
              <p className="text-sm text-muted-foreground">Closes the report{t.suggestedReply?.trim() ? ` and sends ${firstName} the reply below` : ""}. Nothing gets built.</p>
            </div>
          )}
          {actions.canApprove && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => onDecide("approve")} disabled={saving}
                  className="h-14 px-6 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center gap-2 hover:bg-primary/90 disabled:opacity-50">
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                  {status === "rejected" ? "Approve this fix after all" : "Approve this fix"}
                </button>
                {actions.canReply && !t.questionForGraeme && (
                  <button onClick={() => setDialog("reply")} disabled={saving}
                    className="h-14 px-5 rounded-2xl border-2 border-border font-bold flex items-center gap-2 hover:bg-secondary/60 disabled:opacity-50">
                    <MessageCircleQuestion className="w-5 h-5" /> Ask Claude first
                  </button>
                )}
              </div>
              <p className="text-sm text-muted-foreground">Approving tells Claude to go ahead and build this with you. It doesn't message {firstName} — use the reply below for that.</p>
            </div>
          )}
          {actions.approveBlocked && (
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 rounded-xl px-3 py-2.5">
              {actions.waitingOnClaude
                ? "Approve comes back once Claude has answered your reply."
                : "Answer Claude's question above first — once the plan is agreed, you can approve it here."}
            </p>
          )}
        </div>
      )}

      {/* Claude's draft to the reporter — Message lives here. Sending it
          never approves or closes anything unless you choose to. */}
      {t.suggestedReply?.trim() && issue?.reporter.id != null && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-primary mb-1">
              <MessageSquareText className="w-4 h-4" /> Suggested reply to {issue.reporter.name ?? "the reporter"}
            </p>
            <p className="text-base whitespace-pre-wrap">{t.suggestedReply}</p>
          </div>
          <button onClick={() => setDialog("message")} disabled={saving}
            className="h-12 px-5 rounded-xl border-2 border-primary/40 bg-background text-primary font-bold flex items-center gap-2 hover:bg-primary/10 disabled:opacity-50">
            <Send className="w-4 h-4" /> Send to {firstName}…
          </button>
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
      {(t.decidedAt || t.fixRef || item.notices.length > 0 || t.improvementId != null) && (
        <div className="space-y-1 text-sm text-muted-foreground border-t border-border pt-3">
          {t.decidedAt && (
            <p>
              {status === "proposed"
                ? (t.awaitingRetriage ? "You replied" : "You replied — Claude has updated the recommendation")
                : status === "answered"
                  ? `Answered with a message by ${t.decidedBy ?? "you"}`
                  : status === "dismissed"
                  ? `Dismissed as already done by ${t.decidedBy ?? "you"}`
                  : `${status === "rejected" ? "Rejected" : "Approved"} by ${t.decidedBy ?? "you"}`}
              {" · "}{feedTimestamp(t.decidedAt)}
              {t.decisionNote && <span className="block text-foreground">“{t.decisionNote}”</span>}
            </p>
          )}
          {t.improvementId != null && (
            <p className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
              <Award className="w-4 h-4" /> Improvement credited to {issue?.reporter.name ?? "the reporter"}
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

      {/* Housekeeping */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border">
        {actions.canReject && (
          <button onClick={() => setDialog("reject")} disabled={saving}
            className="h-12 px-4 rounded-xl border-2 border-red-300 dark:border-red-900 text-red-700 dark:text-red-300 font-bold flex items-center gap-2 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50">
            <XCircle className="w-5 h-5" /> Reject
          </button>
        )}
        {status === "proposed" && !t.awaitingRetriage && !snoozedUntil && (
          <div className="relative">
            <button onClick={() => setSnoozeOpen(o => !o)} disabled={saving}
              className="h-12 px-4 rounded-xl border-2 border-border font-bold flex items-center gap-2 hover:bg-secondary/60 disabled:opacity-50">
              <AlarmClock className="w-5 h-5" /> Not now
            </button>
            {snoozeOpen && (
              <div className="absolute z-20 bottom-full mb-2 left-0 w-44 rounded-2xl border border-border bg-card shadow-xl p-1.5">
                <p className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">Snooze for</p>
                {SNOOZE_OPTIONS.map(o => (
                  <button key={o.days} onClick={() => { setSnoozeOpen(false); onSnooze(o.days); }}
                    className="w-full text-left px-3 py-2.5 rounded-xl text-base font-medium hover:bg-secondary/60">
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {snoozedUntil && status === "proposed" && (
          <button onClick={() => onSnooze(null)} disabled={saving}
            className="h-12 px-4 rounded-xl border-2 border-border font-bold flex items-center gap-2 hover:bg-secondary/60 disabled:opacity-50">
            <AlarmClock className="w-5 h-5" /> Bring back now
          </button>
        )}
        {!t.suggestedReply?.trim() && issue?.reporter.id != null && (
          <button onClick={() => setDialog("message")} disabled={saving}
            className="h-12 px-4 rounded-xl border-2 border-border font-bold flex items-center gap-2 hover:bg-secondary/60 disabled:opacity-50">
            <MessageSquareText className="w-5 h-5" /> Message {firstName}
          </button>
        )}
        <Link href={`/reports?tab=issues&issueId=${t.andonIssueId}`}
          className="ml-auto text-sm font-medium text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-2 py-2">
          Open in the issue log <ExternalLink className="w-4 h-4" />
        </Link>
      </div>

      {dialog === "message" && (
        <MessageDialog
          reporterName={issue?.reporter.name ?? "the reporter"}
          suggested={t.suggestedReply}
          canClose={["proposed", "approved", "rejected", "wont_fix"].includes(status)}
          onCancel={() => setDialog(null)}
          onSubmit={(message, close) => { setDialog(null); onMessage(message, close); }}
        />
      )}
      {(dialog === "reject" || dialog === "reply") && (
        <NoteDialog
          mode={dialog}
          onCancel={() => setDialog(null)}
          onSubmit={note => { setDialog(null); onDecide(dialog, note || undefined); }}
        />
      )}
    </article>
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
            // Now waiting on Claude: it moves to In progress, off To review.
            items = items.filter(i => i.triage.id !== id);
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

  const sendMessage = useMutation({
    mutationFn: async ({ id, message, close }: { id: number; message: string; close: boolean }) =>
      fetch(`${BASE}/api/issue-pipeline/review/${id}/message`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, close }),
      }).then(jsonOrThrow),
    onMutate: ({ id }) => setSavingIds(s => new Set(s).add(id)),
    onSuccess: (_d, { close }) => toast({
      title: close ? "Sent — report closed" : "Message sent",
      description: "It pops up for them next time they use the app.",
    }),
    onError: (err: Error) => toast({ title: "Not sent", description: err.message, variant: "destructive" }),
    onSettled: (_d, _e, { id }) => {
      setSavingIds(s => { const n = new Set(s); n.delete(id); return n; });
      void qc.invalidateQueries({ queryKey: ["issue-pipeline", "review"] });
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

  if (state.status === "authenticated" && !isFounder) return <Redirect to="/" />;
  if (state.status !== "authenticated") return null;

  const items = data?.items ?? [];
  const saving = savingIds.size > 0;
  // On To review, cards Graeme has replied to fold away below — they're
  // waiting on Claude, not him.
  const needsYou = items;

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
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {TABS.map(t => {
          const n = tabCount(data, t.key);
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
            : TAB_HINTS[tab] ?? null}
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
              ? ((data?.tabCounts?.in_progress ?? 0) > 0
                ? "Nothing needs you right now — the rest are waiting on Claude (see In progress)."
                : "No recommendations waiting for you. New ones appear as Claude reviews the issue log.")
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
            onMessage={(message, close) => sendMessage.mutate({ id: item.triage.id, message, close })}
            onDismiss={() => dismiss.mutate({ id: item.triage.id })}
            onSnooze={days => snooze.mutate({ id: item.triage.id, days })}
          />
        ))}
      </div>

    </div>
  );
}
