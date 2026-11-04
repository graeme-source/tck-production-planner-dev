/**
 * One Fix queue card (redesign, Graeme, 2026-11-04). Three things, in order:
 * what they reported, Claude's assessment, what to do next. Every action
 * lives in ONE row: the recommended one highlighted, the others the same
 * plain colour, the rest behind More. The conversation and the detail are
 * folded away, so a whole card fits on screen.
 */
import { useRef, useState } from "react";
import { Link } from "wouter";
import {
  AlarmClock, Award, Check, CheckCheck, CheckCircle2, ChevronDown, ChevronUp, ClipboardCheck, ExternalLink, HelpCircle, Hourglass, Loader2,
  MessageCircleQuestion, MessageSquareReply, MessageSquareText, MessagesSquare, MoreHorizontal, RotateCcw, Scale, Send, Video, Wrench, X, XCircle,
} from "lucide-react";
import { MarkdownBlock } from "@/components/lesson-media";
import { FixQueueThread, useMarkSeen } from "@/components/fix-queue-conversation";
import { DictateButton } from "@/components/dictate-button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { feedTimestamp } from "@/lib/feed-time";
import {
  LANE_LABELS, QUEUE_TAB_LABELS, cardActions, clockLabel, newReporterWords, noticeStatusLine, recommendedStep, unreadLabel, waitingLine,
  type FixQueueItem, type NextStep, type TriageLane, type TriageStatus,
} from "@/lib/issue-pipeline";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type DecisionAction = "approve" | "reject" | "reply";

export const SNOOZE_OPTIONS: Array<{ days: number; label: string }> = [
  { days: 1, label: "1 day" }, { days: 3, label: "3 days" }, { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" }, { days: 30, label: "1 month" },
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
  in_progress: "In progress", fixed: "Fixed", wont_fix: "Won't fix", answered: "Answered", dismissed: "Dismissed — already done",
};

const SEVERITY_DOT: Record<string, string> = { red: "bg-red-500", yellow: "bg-amber-400", green: "bg-emerald-500" };

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold", className)}>{children}</span>;
}

// ── The photo beside the report, opened in place ────────────────────────────

type Attachment = NonNullable<FixQueueItem["issue"]>["attachments"][number];

function Lightbox({ file, onClose }: { file: Attachment; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[150] bg-black/80 flex items-center justify-center p-3" onClick={onClose}>
      <button onClick={onClose} aria-label="Close" className="absolute top-3 right-3 w-12 h-12 rounded-full bg-white text-black flex items-center justify-center">
        <X className="w-6 h-6" />
      </button>
      <div className="max-w-full max-h-[92dvh]" onClick={e => e.stopPropagation()}>
        {file.kind === "image"
          ? <img src={`${BASE}${file.url}`} alt={file.fileName ?? "Photo from the report"} className="max-w-full max-h-[92dvh] object-contain rounded-xl" />
          : <video src={`${BASE}${file.url}`} controls autoPlay className="max-w-full max-h-[92dvh] rounded-xl" />}
      </div>
    </div>
  );
}

function ReportMedia({ files, onOpen }: { files: Attachment[]; onOpen: (f: Attachment) => void }) {
  const [first, ...rest] = files;
  const thumb = (f: Attachment, className: string) => (
    <button key={f.id} onClick={() => onOpen(f)} aria-label={f.kind === "image" ? "See the photo full size" : "Play the video"}
      className={cn("block rounded-xl overflow-hidden border border-border bg-secondary hover:opacity-90", className)}>
      {f.kind === "image"
        ? <img src={`${BASE}${f.url}`} alt={f.fileName ?? "Photo from the report"} loading="lazy" className="w-full h-full object-cover" />
        : <span className="w-full h-full flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground"><Video className="w-6 h-6" /> Video</span>}
    </button>
  );
  return (
    <div className="space-y-2">
      {thumb(first, "w-full h-40 md:h-44")}
      {rest.length > 0 && <div className="grid grid-cols-4 gap-1.5">{rest.map(f => thumb(f, "aspect-square"))}</div>}
    </div>
  );
}

// ── One place to write: to the reporter, to Claude, or why it's rejected ────

type Composer = "reporter" | "claude" | "reject" | "no_action";

function ComposerPanel({ mode, firstName, startText, canClose, reopens, saving, onCancel, onReporter, onClaude, onReject, onNoAction }: {
  mode: Composer;
  firstName: string;
  startText: string;
  canClose: boolean;
  reopens: boolean;
  saving: boolean;
  onCancel: () => void;
  onReporter: (text: string, close: boolean) => void;
  onClaude: (text: string, fixNow: boolean) => void;
  onReject: (text: string) => void;
  onNoAction: () => void;
}) {
  const [text, setText] = useState(startText);
  const ref = useRef<HTMLTextAreaElement>(null);
  const clean = text.trim();
  if (mode === "no_action") {
    return (
      <div className="rounded-2xl border-2 border-border bg-secondary/40 p-3 flex flex-wrap items-center gap-2">
        <p className="text-base font-semibold flex-1 min-w-[12rem]">Dismiss this? No one will be messaged.</p>
        <button onClick={onCancel} className="h-11 px-4 rounded-xl border-2 border-border bg-card font-bold">Cancel</button>
        <button onClick={onNoAction} disabled={saving} className="h-11 px-4 rounded-xl bg-foreground text-background font-bold disabled:opacity-50">Yes, dismiss it</button>
      </div>
    );
  }
  const title = mode === "reporter" ? `Reply to ${firstName}` : mode === "claude" ? "Reply to Claude" : "Reject this recommendation";
  const hint = mode === "reporter"
    ? `It pops up for ${firstName} with this conversation, and they can reply.`
    : mode === "claude"
      ? `${firstName} doesn't see this.${reopens ? " It reopens the card; your earlier decision stays in its history." : ""}`
      : "Optional: say why, so the next recommendation for something similar is better.";
  return (
    <div className="rounded-2xl border-2 border-primary/40 bg-secondary/30 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <p className="font-bold flex-1">{title}</p>
        <DictateButton value={text} onChange={setText} context="note" />
        <button onClick={onCancel} aria-label="Close" className="p-2 rounded-lg hover:bg-secondary"><X className="w-5 h-5" /></button>
      </div>
      <textarea ref={ref} autoFocus value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={4000}
        className="w-full px-3 py-2.5 bg-background border-2 border-border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-primary/30" />
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground flex-1 min-w-[12rem]">{hint}</p>
        {mode === "reporter" && canClose && (
          <button onClick={() => onReporter(clean, true)} disabled={saving || !clean}
            className="h-11 px-4 rounded-xl bg-secondary border-2 border-border font-bold flex items-center gap-2 disabled:opacity-50">
            <CheckCheck className="w-4 h-4" /> Send and close
          </button>
        )}
        {mode === "reporter" && (
          <button onClick={() => onReporter(clean, false)} disabled={saving || !clean}
            className="h-11 px-5 rounded-xl bg-primary text-primary-foreground font-bold flex items-center gap-2 disabled:opacity-50">
            <Send className="w-4 h-4" /> Send to {firstName}
          </button>
        )}
        {mode === "claude" && (
          <>
            <button onClick={() => onClaude(clean, false)} disabled={saving || !clean}
              className="h-11 px-4 rounded-xl bg-secondary border-2 border-border font-bold disabled:opacity-50">Just send</button>
            <button onClick={() => onClaude(clean, true)} disabled={saving || !clean}
              className="h-11 px-5 rounded-xl bg-primary text-primary-foreground font-bold flex items-center gap-2 disabled:opacity-50">
              <Wrench className="w-4 h-4" /> Send and fix it this way
            </button>
          </>
        )}
        {mode === "reject" && (
          <button onClick={() => onReject(clean)} disabled={saving}
            className="h-11 px-5 rounded-xl bg-red-600 text-white font-bold disabled:opacity-50">Reject</button>
        )}
      </div>
    </div>
  );
}

// ── The card ────────────────────────────────────────────────────────────────

export function FixCard({ item, onDecide, onMessage, onDismiss, onSnooze, onNoAction, saving, showTab = false }: {
  item: FixQueueItem;
  /** Search results: say which tab the card is in now. */
  showTab?: boolean;
  /** "Dismiss — no action" (restore = put it back). */
  onNoAction: (restore: boolean) => void;
  onDecide: (action: DecisionAction, note?: string, fixNow?: boolean) => void;
  onMessage: (message: string, close: boolean) => void;
  onDismiss: () => void;
  /** days = null brings a snoozed card back now. */
  onSnooze: (days: number | null) => void;
  saving: boolean;
}) {
  const { triage: t, issue } = item;
  const [composer, setComposer] = useState<Composer | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const seen = useMarkSeen();

  const unread = item.unreadReplies ?? 0;
  const snoozedUntil = t.snoozedUntil && new Date(t.snoozedUntil).getTime() > Date.now() ? new Date(t.snoozedUntil) : null;
  const actions = cardActions(t);
  const thread = item.thread ?? [];
  const status = t.status;
  const hasReporter = issue?.reporter.id != null;
  const firstName = issue?.reporter.name?.split(" ")[0] ?? "the reporter";
  const alreadyMessaged = thread.some(e => e.who === "you" && e.kind === "message");
  const files = issue?.attachments ?? [];
  const step = recommendedStep(item, hasReporter);
  const waiting = waitingLine(item, firstName);
  const latestWords = newReporterWords(thread).at(-1);
  const repliedBack = unread > 0 || !!t.reporterReplyAt;
  const claudeDraft = t.suggestedReply?.trim() && !alreadyMessaged ? t.suggestedReply : "";

  const open = (mode: Composer) => setComposer(c => (c === mode ? null : mode));
  const buttons: Array<{ step: NextStep; label: string; icon: React.ReactNode; onClick: () => void }> = [];
  if (actions.canDismiss) buttons.push({ step: "dismiss_done", label: "Dismiss — already done", icon: <CheckCircle2 className="w-5 h-5" />, onClick: onDismiss });
  if (actions.canApprove) buttons.push({ step: "approve", label: status === "rejected" ? "Approve after all" : "Approve this fix", icon: <Check className="w-5 h-5" />, onClick: () => onDecide("approve") });
  if (hasReporter) buttons.push({ step: "reply_reporter", label: `Reply to ${firstName}`, icon: <MessageSquareText className="w-5 h-5" />, onClick: () => open("reporter") });
  buttons.push({ step: "reply_claude", label: "Reply to Claude", icon: <MessageCircleQuestion className="w-5 h-5" />, onClick: () => open("claude") });
  // The recommended one goes first and is the only one in colour.
  const ordered = [...buttons].sort((a, b) => Number(b.step === step) - Number(a.step === step));

  const hint = step === "approve" ? `Tells Claude to build it. Nothing goes live until you deploy.`
    : step === "dismiss_done" ? `Closes the report${t.suggestedReply?.trim() ? ` and sends ${firstName} Claude's reply` : ""}. Nothing gets built.`
    : step === "reply_reporter" && !repliedBack && claudeDraft ? `Claude has drafted this for you to check before it goes.`
    : null;

  return (
    <article className={cn(
      "rounded-3xl border-2 bg-card p-4 md:p-5 space-y-3 transition-opacity",
      unread > 0 ? "border-emerald-500 border-l-[10px]" : t.reporterReplyAt ? "border-emerald-300 border-l-[10px]" : "border-border",
      saving && "opacity-60",
    )}>
      {/* Chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip className={LANE_STYLES[t.lane]}>{LANE_LABELS[t.lane]}</Chip>
        {t.behaviourChange && <Chip className="bg-amber-500 text-white"><Scale className="w-3.5 h-3.5" /> Changes agreed behaviour</Chip>}
        {snoozedUntil && status === "proposed" && (
          <Chip className="bg-secondary text-foreground"><AlarmClock className="w-3.5 h-3.5" /> Snoozed until {snoozedUntil.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</Chip>
        )}
        {showTab && item.tab && <Chip className="bg-primary text-primary-foreground">In: {QUEUE_TAB_LABELS[item.tab]}</Chip>}
        {repliedBack && <Chip className="bg-emerald-600 text-white"><MessageSquareReply className="w-3.5 h-3.5" /> {unreadLabel(firstName, unread)}</Chip>}
        {status !== "proposed" && <Chip className="bg-secondary text-foreground">{STATUS_LABELS[status]}</Chip>}
        {item.related.length > 0 && <Chip className="bg-secondary text-foreground">{item.related.length} related report{item.related.length === 1 ? "" : "s"}</Chip>}
        <span className="ml-auto text-xs text-muted-foreground">#{t.andonIssueId} · {issue ? feedTimestamp(issue.createdAt) : feedTimestamp(t.triagedAt)}</span>
      </div>

      {/* 1. What they reported, with the photo beside it */}
      {issue && (
        <div className={cn("grid gap-4", files.length > 0 && "md:grid-cols-[minmax(0,1fr)_16rem]")}>
          <div className="min-w-0">
            <p className={cn("text-lg md:text-xl font-bold leading-snug whitespace-pre-wrap break-words", !showDetails && "line-clamp-6")}>
              {issue.description?.trim() || "(no description)"}
            </p>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{issue.reporter.name ?? "Someone"}</span>
              <span>· {issue.station}</span>
              <span className={cn("w-2.5 h-2.5 rounded-full", SEVERITY_DOT[issue.severity] ?? "bg-muted")} aria-label={issue.severity} />
              {issue.resolved && <span className="text-emerald-700 dark:text-emerald-400 font-medium">Resolved {feedTimestamp(issue.resolved.at)}</span>}
            </p>
          </div>
          {files.length > 0 && <ReportMedia files={files} onOpen={setViewing} />}
        </div>
      )}

      {/* 2. Claude's assessment */}
      <div className="rounded-2xl bg-secondary/50 p-3 md:p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Claude's assessment</p>
        <p className="text-base md:text-lg font-semibold leading-snug">{t.verdictSummary}</p>
        {t.questionForGraeme && status === "proposed" && (
          <p className="flex gap-2 text-base font-medium text-amber-900 dark:text-amber-100 bg-amber-50 dark:bg-amber-950/30 rounded-xl px-3 py-2">
            <HelpCircle className="w-5 h-5 mt-0.5 flex-shrink-0 text-amber-600" />
            <span className="whitespace-pre-wrap">{t.questionForGraeme}</span>
          </p>
        )}
        {repliedBack && latestWords && (
          <p className="flex gap-2 text-base font-medium text-emerald-950 dark:text-emerald-50 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl px-3 py-2">
            <MessageSquareReply className="w-5 h-5 mt-0.5 flex-shrink-0 text-emerald-700" />
            <span className="whitespace-pre-wrap break-words">“{latestWords.text}” <span className="text-sm font-normal opacity-80">— {firstName}, {clockLabel(latestWords.at)}</span></span>
          </p>
        )}
        {t.proposedFix.trim() && !showDetails && (
          <p className="text-sm text-muted-foreground line-clamp-2"><span className="font-semibold text-foreground">Proposed fix:</span> {t.proposedFix}</p>
        )}
      </div>

      {/* 3. What to do next: the one place every action lives */}
      <div className="space-y-1.5">
        {!step && waiting && (
          <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><Hourglass className="w-4 h-4" /> {waiting}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {ordered.map(b => (
            <button key={b.step} onClick={b.onClick} disabled={saving}
              className={cn(
                "rounded-xl font-bold flex items-center gap-2 disabled:opacity-50",
                b.step === step
                  ? "h-12 px-5 bg-primary text-primary-foreground text-base shadow-md hover:bg-primary/90"
                  : "h-12 px-3 bg-secondary text-foreground hover:bg-secondary/70",
              )}>
              {saving && b.step === step ? <Loader2 className="w-5 h-5 animate-spin" /> : b.icon} {b.label}
            </button>
          ))}
          {(thread.length > 0 || hasReporter) && (
            <button onClick={() => setShowChat(o => !o)} aria-expanded={showChat}
              className="h-12 px-3 rounded-xl bg-secondary text-foreground font-bold flex items-center gap-1.5 hover:bg-secondary/70">
              <MessagesSquare className="w-5 h-5" /> Chat{thread.length > 0 ? ` · ${thread.length}` : ""}
              {unread > 0 && <span className="rounded-full bg-emerald-600 text-white px-2 text-xs">{unread}</span>}
            </button>
          )}
          <button onClick={() => setShowDetails(o => !o)} aria-expanded={showDetails}
            className="h-12 px-3 rounded-xl bg-secondary text-foreground font-bold flex items-center gap-1.5 hover:bg-secondary/70">
            {showDetails ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />} Details
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-12 px-3 rounded-xl bg-secondary text-foreground font-bold flex items-center gap-1.5 hover:bg-secondary/70">
                <MoreHorizontal className="w-5 h-5" /> More
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {actions.canReject && (
                <DropdownMenuItem className="py-2.5" onSelect={() => setComposer("reject")}><XCircle className="w-4 h-4 mr-2" /> Reject</DropdownMenuItem>
              )}
              {status === "proposed" && !t.awaitingRetriage && !snoozedUntil && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="py-2.5"><AlarmClock className="w-4 h-4 mr-2" /> Not now</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {SNOOZE_OPTIONS.map(o => <DropdownMenuItem key={o.days} className="py-2.5" onSelect={() => onSnooze(o.days)}>{o.label}</DropdownMenuItem>)}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {snoozedUntil && status === "proposed" && (
                <DropdownMenuItem className="py-2.5" onSelect={() => onSnooze(null)}><AlarmClock className="w-4 h-4 mr-2" /> Bring back now</DropdownMenuItem>
              )}
              {t.reporterReplyAt && (
                <DropdownMenuItem className="py-2.5" onSelect={() => seen.mutate(t.id)}><CheckCheck className="w-4 h-4 mr-2" /> Seen — leave it where it was</DropdownMenuItem>
              )}
              {t.noActionAt
                ? <DropdownMenuItem className="py-2.5" onSelect={() => onNoAction(true)}><RotateCcw className="w-4 h-4 mr-2" /> Restore</DropdownMenuItem>
                : <DropdownMenuItem className="py-2.5" onSelect={() => setComposer("no_action")}><X className="w-4 h-4 mr-2" /> Dismiss — no action</DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="py-2.5" asChild>
                <Link href={`/test-requests?new=1&issue=${t.andonIssueId}`}><ClipboardCheck className="w-4 h-4 mr-2" /> Request a test</Link>
              </DropdownMenuItem>
              <DropdownMenuItem className="py-2.5" asChild>
                <Link href={`/reports?tab=issues&issueId=${t.andonIssueId}`}><ExternalLink className="w-4 h-4 mr-2" /> Open in the issue log</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>

      {composer && (
        <ComposerPanel
          key={composer}
          mode={composer}
          firstName={firstName}
          startText={composer === "reporter" ? claudeDraft : ""}
          canClose={["proposed", "approved", "rejected", "wont_fix"].includes(status)}
          reopens={actions.replyReopens || !!t.noActionAt}
          saving={saving}
          onCancel={() => setComposer(null)}
          onReporter={(text, close) => { setComposer(null); onMessage(text, close); }}
          onClaude={(text, fixNow) => { setComposer(null); onDecide("reply", text, fixNow); }}
          onReject={text => { setComposer(null); onDecide("reject", text || undefined); }}
          onNoAction={() => { setComposer(null); onNoAction(false); }}
        />
      )}

      {showChat && <FixQueueThread item={item} firstName={firstName} />}

      {showDetails && (
        <div className="space-y-3 border-t border-border pt-3">
          {issue?.reportContext && <p className="text-sm text-muted-foreground">Context: {issue.reportContext}</p>}
          {t.explanation.trim() && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">Why</p>
              <div className="[&_div]:text-base [&_p]:whitespace-pre-wrap break-words"><MarkdownBlock content={t.explanation} /></div>
            </div>
          )}
          {t.proposedFix.trim() && (
            <div>
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1"><Wrench className="w-4 h-4" /> Proposed fix</p>
              <p className="text-base whitespace-pre-wrap">{t.proposedFix}</p>
            </div>
          )}
          {claudeDraft && (
            <div>
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1"><MessageSquareText className="w-4 h-4" /> Claude's draft reply to {firstName}</p>
              <p className="text-base whitespace-pre-wrap">{claudeDraft}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
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
                    <span className="flex-1 min-w-0 break-words">{r.description ?? "—"}</span>
                    {r.reporterName && <span className="text-muted-foreground hidden sm:inline">{r.reporterName}</span>}
                    {r.resolvedAt && <Check className="w-4 h-4 text-emerald-600" />}
                  </Link>
                ))}
              </div>
            </div>
          )}
          {(t.decidedAt || t.fixRef || item.notices.length > 0 || t.improvementId != null) && (
            <div className="space-y-1 text-sm text-muted-foreground">
              {t.decidedAt && (
                <p>
                  {status === "proposed"
                    ? (t.awaitingRetriage ? "You replied" : "You replied — Claude has updated the recommendation")
                    : status === "answered" ? `Answered with a message by ${t.decidedBy ?? "you"}`
                    : status === "dismissed" ? `Dismissed as already done by ${t.decidedBy ?? "you"}`
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
              {item.notices.map(n => (
                <p key={n.id} className="flex items-center gap-1.5">
                  <CheckCircle2 className={cn("w-4 h-4", n.acknowledgedAt ? "text-emerald-600" : "text-muted-foreground")} />
                  {noticeStatusLine(n)}{n.andonIssueId !== t.andonIssueId ? ` (#${n.andonIssueId})` : ""}
                  {" · "}{feedTimestamp(n.acknowledgedAt ?? n.createdAt)}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {viewing && <Lightbox file={viewing} onClose={() => setViewing(null)} />}
    </article>
  );
}
