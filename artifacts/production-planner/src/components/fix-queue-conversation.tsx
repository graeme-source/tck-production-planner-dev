/**
 * Fix queue — talking with the reporter (Graeme, 2026-10-13; reworked
 * 21 Oct 2026; Objectives E, F). Kept out of the already-long
 * pages/founder-fix-queue.tsx.
 *
 * "I don't think I can see Jane's replies to my messages to her … I can
 * answer her and go back to her on that issue and see the conversational
 * history like I can with Claude." So each card has ONE chat:
 *
 *  - FixQueueThread — everything on the card in time order, oldest at the
 *    top: Claude's notes, Graeme's messages to the reporter, his replies to
 *    Claude (marked as private), the reporter's replies by first name, and
 *    small notes for decisions and "Jane read your message". A reply box at
 *    the bottom messages the reporter through the existing send path, so it
 *    pops up for them where they already read his messages — with the whole
 *    conversation above it — and they can answer again.
 *  - Unread replies — the card is flagged "Jane replied" with a green strip
 *    and sorted to the top; the badge clears once the conversation has been
 *    on screen for a moment (POST /review/:id/read), without moving the card.
 *  - useFixQueueUnread — the count on the Fix queue nav item.
 *  - FixQueueSearch — one box over EVERY tab.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, Loader2, MessageSquareReply, Search, Send, X } from "lucide-react";
import { DictateButton } from "@/components/dictate-button";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  chatLine, clockLabel, newReporterWords, unreadLabel, withThreadRead,
  type FixQueueItem, type FixQueueResponse, type FixQueueUnread,
} from "@/lib/issue-pipeline";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function post(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

/** Unread replies from reporters — the count on the Fix queue nav item. */
export function useFixQueueUnread(enabled: boolean) {
  return useQuery<FixQueueUnread>({
    queryKey: ["issue-pipeline", "unread"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/issue-pipeline/review/unread`, { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return res.json();
    },
    enabled,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}

/** Graeme has read the card's conversation: badge off, card stays put. */
function useMarkThreadRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => post(`/api/issue-pipeline/review/${id}/read`),
    onMutate: (id: number) => {
      // Every cached Fix queue list: this card's badge goes now. The list is
      // NOT refetched, so the card doesn't jump while he's reading it.
      qc.setQueriesData<FixQueueResponse>({ queryKey: ["issue-pipeline", "review"] }, prev =>
        prev ? { ...prev, items: prev.items.map(i => (i.triage.id === id ? withThreadRead(i) : i)) } : prev);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["issue-pipeline", "unread"] }),
  });
}

/** "Seen — leave it where it was": clears "<name> replied" so the card goes
 *  back to the tab its status puts it in. */
function useMarkSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => post(`/api/issue-pipeline/review/${id}/seen`),
    onSuccess: () => toast({ title: "Marked as seen", description: "The card goes back to where it was." }),
    onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["issue-pipeline", "review"] });
      void qc.invalidateQueries({ queryKey: ["issue-pipeline", "unread"] });
    },
  });
}

/** The green strip at the top of a card the reporter has answered. */
export function ReporterRepliedStrip({ item, firstName, saving, onOpen }: {
  item: FixQueueItem;
  firstName: string;
  saving: boolean;
  /** Scroll to the conversation and its reply box. */
  onOpen: () => void;
}) {
  const seen = useMarkSeen();
  const unread = item.unreadReplies ?? 0;
  const words = newReporterWords(item.thread ?? []);
  const latest = words[words.length - 1];
  return (
    <div className={cn(
      "rounded-2xl border-2 p-4 space-y-3",
      unread > 0 ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40" : "border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20",
    )}>
      <div className="flex gap-3">
        <MessageSquareReply className="w-7 h-7 text-emerald-700 dark:text-emerald-300 flex-shrink-0" />
        <div className="min-w-0 space-y-1">
          <p className="text-base font-bold text-emerald-900 dark:text-emerald-200">
            {unreadLabel(firstName, unread)}
            {latest && <span className="font-normal text-sm text-emerald-800/80 dark:text-emerald-300/80"> · {clockLabel(latest.at)}</span>}
          </p>
          {latest && <p className="text-lg font-semibold whitespace-pre-wrap break-words">“{latest.text}”</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={onOpen} disabled={saving}
          className="h-12 px-4 rounded-xl bg-emerald-700 text-white font-bold flex items-center gap-2 hover:bg-emerald-800 disabled:opacity-50">
          <MessageSquareReply className="w-5 h-5" /> Answer {firstName}
        </button>
        {item.triage.reporterReplyAt && (
          <button onClick={() => seen.mutate(item.triage.id)} disabled={saving || seen.isPending}
            className="h-12 px-4 rounded-xl border-2 border-border bg-card font-bold flex items-center gap-2 hover:bg-secondary/60 disabled:opacity-50">
            {seen.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCheck className="w-5 h-5" />} Seen — leave it where it was
          </button>
        )}
      </div>
    </div>
  );
}

const TONE: Record<string, string> = {
  you: "bg-primary text-primary-foreground",
  reporter: "bg-emerald-100 text-emerald-950 dark:bg-emerald-900/50 dark:text-emerald-50 border-2 border-emerald-300 dark:border-emerald-700",
  claude: "bg-sky-50 text-foreground dark:bg-sky-950/40 border border-sky-200 dark:border-sky-900",
};

export interface FixQueueThreadHandle {
  /** Scroll to the reply box and focus it, optionally with text in it. */
  focusReply: (text?: string) => void;
}

/** The one conversation on a card, with the reply box to the reporter. */
export const FixQueueThread = forwardRef<FixQueueThreadHandle, {
  item: FixQueueItem;
  firstName: string;
  /** The report has a reporter we can message. */
  canMessage: boolean;
  /** "Send and close" is only for reports not already closed or being fixed. */
  canClose: boolean;
  saving: boolean;
  onMessage: (message: string, close: boolean) => void;
}>(function FixQueueThread({ item, firstName, canMessage, canClose, saving, onMessage }, ref) {
  const thread = item.thread ?? [];
  const unread = item.unreadReplies ?? 0;
  const [draft, setDraft] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  // The bottom of the conversation, where the newest reply is: seeing it is reading it.
  const endRef = useRef<HTMLLIElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const markRead = useMarkThreadRead();
  const firstUnreadAt = unread > 0
    ? thread.filter(e => e.who === "reporter" && e.kind === "reply").slice(-unread)[0]?.at ?? null
    : null;

  useImperativeHandle(ref, () => ({
    focusReply: (text?: string) => {
      if (text != null) setDraft(text);
      inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => inputRef.current?.focus(), 350);
    },
  }), []);

  // Opening the conversation reads it: once it has been on screen for a
  // couple of seconds the unread badge goes (the card stays where it is).
  const triageId = item.triage.id;
  const mutateRead = markRead.mutate;
  useEffect(() => {
    if (unread === 0 || !endRef.current || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Not while a pop-up covers the page or the app is in the background —
    // on screen behind a dialog isn't read.
    // (A closed drawer stays in the page marked inert — that doesn't count.)
    const covered = () => document.hidden || [...document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"]')]
      .some(el => !el.closest("[inert]") && el.getClientRects().length > 0);
    const arm = () => {
      timer = setTimeout(() => { if (covered()) arm(); else mutateRead(triageId); }, 2000);
    };
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { if (!timer) arm(); }
      else if (timer) { clearTimeout(timer); timer = null; }
    });
    obs.observe(endRef.current);
    return () => { obs.disconnect(); if (timer) clearTimeout(timer); };
  }, [unread, triageId, mutateRead]);

  const send = (close: boolean) => {
    const text = draft.trim();
    if (!text) return;
    onMessage(text, close);
    setDraft("");
  };

  return (
    <section
      ref={boxRef}
      aria-label={`Conversation with ${firstName} and Claude`}
      className={cn("rounded-2xl border-2 overflow-hidden", unread > 0 ? "border-emerald-500" : "border-border")}
    >
      <div className={cn("flex flex-wrap items-center gap-2 px-4 py-3 border-b", unread > 0 ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900" : "bg-secondary/40 border-border")}>
        <p className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Conversation</p>
        <span className="text-sm text-muted-foreground">you, {firstName} and Claude · oldest first</span>
        {unread > 0 && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-600 text-white px-3 py-1 text-sm font-bold">
            <MessageSquareReply className="w-4 h-4" /> {unread} new from {firstName}
          </span>
        )}
      </div>

      <ol className="p-3 md:p-4 space-y-2.5 bg-card">
        {thread.length === 0 && <li className="text-sm text-muted-foreground text-center py-2">Nothing yet.</li>}
        {thread.map((e, i) => {
          const line = chatLine(e, firstName);
          const isNew = firstUnreadAt != null && e.who === "reporter" && e.kind === "reply" && e.at >= firstUnreadAt;
          if (line.side === "centre") {
            return (
              <li key={i} className="flex justify-center">
                <p className="text-xs text-muted-foreground bg-secondary/50 rounded-full px-3 py-1 text-center">
                  {line.text} · {clockLabel(e.at)}
                </p>
              </li>
            );
          }
          return (
            <li key={i} className={cn("flex", line.side === "right" ? "justify-end" : "justify-start")}>
              <div className={cn(
                "max-w-[88%] md:max-w-[75%] rounded-2xl px-4 py-2.5 shadow-sm",
                TONE[line.tone],
                line.side === "right" ? "rounded-br-md" : "rounded-bl-md",
                isNew && "ring-4 ring-emerald-400/60",
                // His private notes to Claude read quieter than his messages to the reporter.
                e.who === "you" && e.kind === "reply" && "bg-primary/15 text-foreground border border-primary/30",
              )}>
                <p className={cn("text-xs font-bold mb-0.5", line.tone === "you" && e.kind === "message" ? "text-primary-foreground/85" : "text-muted-foreground")}>
                  {line.label}
                  {isNew && <span className="ml-1.5 rounded-full bg-emerald-600 text-white px-1.5 py-px text-[10px] uppercase">New</span>}
                  <span className="font-normal"> · {clockLabel(e.at)}</span>
                </p>
                <p className="text-base whitespace-pre-wrap break-words">{line.text}</p>
              </div>
            </li>
          );
        })}
        <li ref={endRef} aria-hidden="true" className="h-px" />
      </ol>

      {canMessage && (
        <div className="border-t border-border bg-secondary/30 p-3 md:p-4 space-y-2">
          <div className="flex items-center gap-2">
            <label htmlFor={`fixq-reply-${item.triage.id}`} className="text-sm font-bold flex-1">Message {firstName}</label>
            <DictateButton value={draft} onChange={setDraft} context="note" />
          </div>
          <textarea
            id={`fixq-reply-${item.triage.id}`}
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            maxLength={4000}
            rows={3}
            placeholder={`Write to ${firstName} — it pops up for them with this conversation, and they can reply`}
            className="w-full px-3 py-2.5 bg-background border-2 border-border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2">
            <p className="text-xs text-muted-foreground flex-1">
              The card stays where it is, waiting for {firstName}'s answer.{canClose ? " “Send and close” closes the report too." : ""}
            </p>
            {canClose && (
              <button onClick={() => send(true)} disabled={saving || !draft.trim()}
                className="h-12 px-4 rounded-xl border-2 border-primary/40 text-primary font-bold flex items-center justify-center gap-2 hover:bg-primary/10 disabled:opacity-50">
                <CheckCheck className="w-4 h-4" /> Send and close
              </button>
            )}
            <button onClick={() => send(false)} disabled={saving || !draft.trim()}
              className="h-12 px-5 rounded-xl bg-primary text-primary-foreground font-bold flex items-center justify-center gap-2 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send to {firstName}
            </button>
          </div>
        </div>
      )}
    </section>
  );
});

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
