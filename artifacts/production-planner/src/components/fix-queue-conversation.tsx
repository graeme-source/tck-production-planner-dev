/**
 * Fix queue — talking with the reporter (Graeme, 2026-10-13; Objectives E, F).
 * Kept out of the already-long pages/founder-fix-queue.tsx.
 *
 * Issue #323: Graeme asked Jane a question from the card; the old message box
 * had "This answers it — close the report" ticked by default, so the card
 * closed and vanished from To review. Now:
 *
 *  - MessageReporterDialog — two clear buttons. "Message <name>" (the main
 *    one) sends and KEEPS the card where it is, marked "Waiting for <name>'s
 *    reply". "Send and close" is the old close, for when the reply ends it.
 *  - ReporterReplyBox — when the reporter answers (typed reply in their
 *    pop-up or on the issue log, or "Got it" on a question) the card is back
 *    in To review with their words. "Seen" leaves it where it was; any other
 *    action on the card (message again, Reply to Claude…) also clears it.
 *  - FixQueueSearch — one box over EVERY tab, so a card that moved is always
 *    findable by issue number, reporter or words.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, Loader2, MessageSquareReply, MessageSquareText, Search, Send, X } from "lucide-react";
import { DictateButton } from "@/components/dictate-button";
import { toast } from "@/hooks/use-toast";
import { feedTimestamp } from "@/lib/feed-time";
import { newReporterWords, type ThreadEntry } from "@/lib/issue-pipeline";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** "Message <name>" / "Send and close". */
export function MessageReporterDialog({ reporterName, firstName, suggested, canClose, onCancel, onSubmit }: {
  reporterName: string;
  firstName: string;
  /** Claude's draft, pre-filled (only before the first message). */
  suggested: string | null;
  /** "Send and close" is only for reports not already closed or being fixed. */
  canClose: boolean;
  onCancel: () => void;
  onSubmit: (message: string, close: boolean) => void;
}) {
  const [message, setMessage] = useState(suggested ?? "");
  const ready = message.trim().length > 0;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 md:p-8" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="message-reporter-title"
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <MessageSquareText className="w-5 h-5 text-primary" />
          <h2 id="message-reporter-title" className="font-display font-bold text-lg flex-1">Message {reporterName}</h2>
          <button onClick={onCancel} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <p className="text-sm text-muted-foreground">
            {suggested
              ? `Claude drafted this — check it, change anything, then send. It pops up full-screen for ${firstName} next time they use the app, and they can reply.`
              : `It pops up full-screen for ${firstName} next time they use the app, and they can reply. Message as often as you like.`}
          </p>
          <div className="flex justify-end">
            <DictateButton value={message} onChange={setMessage} context="note" />
          </div>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            autoFocus
            maxLength={4000}
            placeholder="e.g. Do you only want the XXL tin size taken off, or every tin size? Why?"
            className="w-full min-h-[180px] px-3 py-2.5 bg-background border border-border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <ul className="text-sm text-muted-foreground space-y-1">
            <li><span className="font-semibold text-foreground">Message {firstName}</span> — the card stays where it is, marked “Waiting for {firstName}'s reply”. Their answer brings it back to To review.</li>
            {canClose
              ? <li><span className="font-semibold text-foreground">Send and close</span> — only when this reply ends it: closes the report{" "}and moves the card to Done.</li>
              : <li>This report is already closed or being fixed — sending won't change that.</li>}
          </ul>
        </div>
        <div className="p-5 pt-0 flex flex-col-reverse sm:flex-row gap-2">
          <button onClick={onCancel} className="sm:flex-1 h-12 rounded-xl border border-border font-semibold hover:bg-secondary/60">
            Cancel
          </button>
          {canClose && (
            <button
              onClick={() => onSubmit(message.trim(), true)}
              disabled={!ready}
              className="sm:flex-1 h-12 rounded-xl border-2 border-primary/40 text-primary font-bold flex items-center justify-center gap-2 hover:bg-primary/10 disabled:opacity-50"
            >
              <CheckCheck className="w-4 h-4" /> Send and close
            </button>
          )}
          <button
            onClick={() => onSubmit(message.trim(), false)}
            disabled={!ready}
            className="sm:flex-1 h-12 rounded-xl bg-primary text-primary-foreground font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Send className="w-4 h-4" /> Message {firstName}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Seen — leave it where it was": clears "New reply from <name>". */
function useMarkSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/issue-pipeline/review/${id}/seen`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      return body;
    },
    onSuccess: () => toast({ title: "Marked as seen", description: "The card is back where it was." }),
    onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["issue-pipeline", "review"] }),
  });
}

/** The reporter's answer, at the top of the card, with what to do next. */
export function ReporterReplyBox({ triageId, reporterName, firstName, thread, saving, onMessage }: {
  triageId: number;
  reporterName: string;
  firstName: string;
  thread: ThreadEntry[];
  saving: boolean;
  onMessage: () => void;
}) {
  const seen = useMarkSeen();
  const words = newReporterWords(thread);
  return (
    <div className="rounded-2xl border-2 border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 p-4 space-y-3">
      <div className="flex gap-3">
        <MessageSquareReply className="w-6 h-6 text-emerald-700 dark:text-emerald-300 flex-shrink-0" />
        <div className="min-w-0 space-y-1.5">
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">New reply from {reporterName}</p>
          {words.length === 0
            ? <p className="text-base">{firstName} has answered — see the conversation below.</p>
            : words.map((w, i) => (
              <p key={i} className={w.kind === "reply" ? "text-lg font-semibold whitespace-pre-wrap" : "text-sm text-muted-foreground"}>
                {w.kind === "reply" ? `“${w.text}”` : w.text.replace(/^Issue #\d+: /, "")}
                <span className="text-xs font-normal text-muted-foreground"> · {feedTimestamp(w.at)}</span>
              </p>
            ))}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Tell Claude what to do with it (Reply to Claude), message {firstName} again, or mark it seen. Claude isn't told unless you reply to it.
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={onMessage} disabled={saving}
          className="h-12 px-4 rounded-xl bg-emerald-700 text-white font-bold flex items-center gap-2 hover:bg-emerald-800 disabled:opacity-50">
          <MessageSquareText className="w-5 h-5" /> Message {firstName}
        </button>
        <button onClick={() => seen.mutate(triageId)} disabled={saving || seen.isPending}
          className="h-12 px-4 rounded-xl border-2 border-border bg-card font-bold flex items-center gap-2 hover:bg-secondary/60 disabled:opacity-50">
          {seen.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCheck className="w-5 h-5" />} Seen — leave it where it was
        </button>
      </div>
    </div>
  );
}

/** One search box over every tab. */
export function FixQueueSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Find a card — issue number, name or words (all tabs)"
        aria-label="Search every Fix queue tab"
        className="w-full h-12 pl-11 pr-11 rounded-2xl border-2 border-border bg-card text-base focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      {value && (
        <button onClick={() => onChange("")} aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary">
          <X className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}
