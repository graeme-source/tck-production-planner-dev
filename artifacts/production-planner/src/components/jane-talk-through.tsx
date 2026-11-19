/**
 * AI Jane talks an app report or idea through before it's filed (Graeme,
 * 19 Nov 2026): a few tap-to-answer questions, then a summary the person
 * checks and sends. "Just send it" is always there, and any failure files
 * the report with what's been said, so she can never stop one.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Send, CheckCircle2 } from "lucide-react";
import { JaneAvatar } from "@/components/jane-avatar";
import { DictateButton } from "@/components/dictate-button";
import type { JaneTurn } from "@/components/jane-report-check";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type TalkKind = "issue" | "idea";
export type TalkStep =
  | { kind: "question"; message: string; choices: string[] }
  | { kind: "brief"; message: string; brief: string };

/** Does this person get Jane's questions? Off = report as before. */
export function useTalkThroughAvailable(enabled: boolean): boolean {
  const q = useQuery<{ available: boolean; switchOn: boolean }>({
    queryKey: ["report-chat", "status"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/report-chat/status`, { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return res.json();
    },
    enabled,
    staleTime: 5 * 60_000,
  });
  return q.data?.available === true;
}

/** Jane's next move, or null: file it as it is. */
export async function nextTalkStep(kind: TalkKind, history: JaneTurn[], opts: { station?: string | null; finish?: boolean } = {}): Promise<TalkStep | null> {
  try {
    const res = await fetch(`${BASE}/api/report-chat/turn`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, history, station: opts.station ?? null, finish: opts.finish ?? false }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return null;
    return (await res.json()).step ?? null;
  } catch {
    return null;
  }
}

/** Keep the chat against what it produced. A failure here loses nothing filed. */
export async function saveTalkThrough(body: {
  kind: TalkKind; andonIssueId?: number; improvementId?: number; original: string; transcript: JaneTurn[]; brief: string | null;
}): Promise<void> {
  await fetch(`${BASE}/api/report-chat/save`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).catch(() => undefined);
}

/** What gets filed: their words first, then the summary they agreed. Same
 *  wording as describeWithBrief() on the server (report-chat-rules.ts). */
export function describeWithBrief(original: string, brief: string | null): string {
  const b = (brief ?? "").trim();
  return b ? `${original.trim()}\n\nTalked through with AI Jane:\n${b}` : original.trim();
}

export function JaneTalkThrough({ chat, step, busy, onAnswer, onSendAsIs, onSend }: {
  chat: JaneTurn[];
  step: TalkStep;
  busy: boolean;
  onAnswer: (text: string) => void;
  onSendAsIs: () => void;
  onSend: (brief: string) => void;
}) {
  const [text, setText] = useState("");
  const [brief, setBrief] = useState(step.kind === "brief" ? step.brief : "");
  const big = "w-full h-14 rounded-2xl text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.99] transition-all";
  const answer = (t: string) => { if (!t.trim() || busy) return; setText(""); onAnswer(t.trim()); };
  // Jane's latest line is the step itself, shown below the chat so far.
  const shown = chat.filter((_, i) => !(i === chat.length - 1 && chat[i].role === "assistant"));

  return (
    <div className="space-y-3">
      <ol className="space-y-2.5">
        {shown.map((m, i) => (
          <li key={i} className={cn("flex gap-2", m.role === "user" ? "justify-end" : "justify-start")}>
            {m.role === "assistant" && <JaneAvatar className="w-9 h-9 flex-shrink-0" />}
            <p className={cn(
              "max-w-[85%] rounded-2xl px-4 py-2.5 text-base whitespace-pre-wrap break-words",
              m.role === "user" ? "bg-secondary" : "bg-primary/10 border border-primary/30",
            )}>{m.text}</p>
          </li>
        ))}
      </ol>

      <div className="flex gap-2">
        <JaneAvatar className="w-9 h-9 flex-shrink-0" />
        <p className="flex-1 rounded-2xl px-4 py-3 text-lg font-semibold bg-primary/10 border-2 border-primary/40 whitespace-pre-wrap break-words">
          {step.message}
        </p>
      </div>

      {step.kind === "question" ? (
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[...step.choices, "Not sure"].map(c => (
              <button key={c} onClick={() => answer(c)} disabled={busy}
                className={cn(
                  "min-h-14 px-4 py-2 rounded-2xl border-2 text-base font-bold text-left disabled:opacity-50 active:scale-[0.99] transition-all",
                  c === "Not sure" ? "border-border bg-card text-muted-foreground" : "border-primary/50 bg-card hover:bg-primary/10",
                )}>
                {c}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-sm font-medium text-muted-foreground">Or say it in your own words</span>
            <DictateButton value={text} onChange={setText} context="note" />
          </div>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={2} placeholder="Type your answer"
            className="w-full px-4 py-3 rounded-2xl border-2 border-border bg-card text-base focus:outline-none focus:ring-2 focus:ring-primary/40" />
          {text.trim() && (
            <button onClick={() => answer(text)} disabled={busy} className={cn(big, "bg-primary text-primary-foreground")}>
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />} Send to Jane
            </button>
          )}
          {busy && !text.trim() && (
            <p className="flex items-center justify-center gap-2 text-muted-foreground py-2"><Loader2 className="w-5 h-5 animate-spin" /> Jane's thinking…</p>
          )}
          <button onClick={onSendAsIs} disabled={busy} className={cn(big, "border-2 border-border hover:bg-secondary/50")}>
            Just send it as it is
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-muted-foreground">What gets sent (change anything that's wrong)</label>
          <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={Math.min(10, Math.max(4, brief.split("\n").length + 1))}
            className="w-full px-4 py-3 rounded-2xl border-2 border-primary/40 bg-card text-base focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y" />
          <button onClick={() => onSend(brief)} disabled={busy} className={cn(big, "bg-primary text-primary-foreground")}>
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />} Send it
          </button>
          <p className="text-sm text-muted-foreground text-center">Nothing gets built until it's approved.</p>
        </div>
      )}
    </div>
  );
}
