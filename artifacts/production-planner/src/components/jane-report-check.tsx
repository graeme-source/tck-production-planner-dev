/**
 * AI Jane's answer on an app report (Graeme, 2026-11-04): "You can already do
 * this, here's where", "This is still in the queue", or one question back.
 * Reporting it anyway is always one press away.
 */
import { useState } from "react";
import { ArrowRight, BellRing, Loader2, Send } from "lucide-react";
import { JaneAvatar } from "@/components/jane-avatar";
import { DictateButton } from "@/components/dictate-button";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface JaneTurn { role: "user" | "assistant"; text: string }
export interface JaneAnswer {
  outcome: "already_possible" | "already_reported" | "ask" | "new";
  message: string;
  path: string | null;
  issueId: number | null;
}

/** Jane's answer, or nothing if she can't help: the report is then just filed. */
export async function runJaneCheck(history: JaneTurn[]): Promise<{ answer: JaneAnswer | null; checkId: number | null }> {
  try {
    const res = await fetch(`${BASE}/api/issue-check`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ history }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return { answer: null, checkId: null };
    const body = await res.json();
    return { answer: body.answer ?? null, checkId: body.checkId ?? null };
  } catch {
    return { answer: null, checkId: null };
  }
}

export async function reportCheckResult(checkId: number, result: "resolved" | "followed" | "reported", filedIssueId?: number): Promise<void> {
  await fetch(`${BASE}/api/issue-check/${checkId}/result`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ result, filedIssueId: filedIssueId ?? null }),
  }).catch(() => undefined);
}

export function JaneCheckPanel({ chat, answer, busy, onReply, onReportAnyway, onShowMe, onKeepPosted }: {
  chat: JaneTurn[];
  answer: JaneAnswer;
  busy: boolean;
  onReply: (text: string) => void;
  onReportAnyway: () => void;
  onShowMe: () => void;
  onKeepPosted: () => void;
}) {
  const [text, setText] = useState("");
  const big = "w-full h-14 rounded-2xl text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50";
  return (
    <div className="space-y-3">
      <ol className="space-y-2.5">
        {chat.map((m, i) => (
          <li key={i} className={cn("flex gap-2", m.role === "user" ? "justify-end" : "justify-start")}>
            {m.role === "assistant" && <JaneAvatar className="w-9 h-9 flex-shrink-0" />}
            <p className={cn(
              "max-w-[85%] rounded-2xl px-4 py-2.5 text-base whitespace-pre-wrap break-words",
              m.role === "user" ? "bg-secondary" : "bg-primary/10 border border-primary/30 font-medium",
            )}>{m.text}</p>
          </li>
        ))}
      </ol>
      {answer.outcome === "ask" && (
        <div className="space-y-2">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={2} autoFocus placeholder="Type your answer"
            className="w-full px-4 py-3 rounded-2xl border-2 border-border bg-card text-base focus:outline-none focus:ring-2 focus:ring-primary/40" />
          <DictateButton value={text} onChange={setText} context="note" />
          <button onClick={() => onReply(text.trim())} disabled={busy || !text.trim()} className={cn(big, "bg-primary text-primary-foreground")}>
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />} Send to Jane
          </button>
        </div>
      )}
      {answer.outcome === "already_possible" && (
        <button onClick={onShowMe} disabled={busy} className={cn(big, "bg-primary text-primary-foreground")}>
          <ArrowRight className="w-5 h-5" /> Show me
        </button>
      )}
      {answer.outcome === "already_reported" && (
        <button onClick={onKeepPosted} disabled={busy} className={cn(big, "bg-primary text-primary-foreground")}>
          <BellRing className="w-5 h-5" /> Keep me posted
        </button>
      )}
      <button onClick={onReportAnyway} disabled={busy} className={cn(big, "border-2 border-border hover:bg-secondary/50")}>
        {busy && answer.outcome !== "ask" && <Loader2 className="w-5 h-5 animate-spin" />}
        {answer.outcome === "ask" ? "Just report it" : answer.outcome === "already_reported" ? "It's different, report it" : "That's not it, report it"}
      </button>
    </div>
  );
}
