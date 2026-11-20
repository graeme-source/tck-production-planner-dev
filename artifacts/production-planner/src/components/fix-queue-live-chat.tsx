/**
 * Ask Claude, live (Graeme, 20 Nov 2026: "rather than sending a message and
 * waiting for a reply an hour later… have a conversation with it"). Claude
 * answers in seconds from the card's report, Jane chat, recommendation and
 * history, and can look things up in the app's data. When it's worked out,
 * "Turn this into the fix instruction" drafts the message for the hourly
 * reviewer, which goes with the card's usual Just send / Send and fix it.
 * Server: routes/fix-queue-chat.ts (founder only, read-only).
 */
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Send, Sparkles, Wrench, X } from "lucide-react";
import { DictateButton } from "@/components/dictate-button";
import { BoldText } from "@/components/bold-text";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Turn = { role: "user" | "assistant"; text: string };

async function ask(issueId: number, history: Turn[], summarise: boolean): Promise<string> {
  const res = await fetch(`${BASE}/api/fix-queue-chat/${issueId}`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ history, summarise }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return String(body.text ?? "");
}

function Thinking() {
  return (
    <span className="flex items-center gap-1 py-1" role="status" aria-label="Claude is working it out">
      {[0, 150, 300].map(d => <span key={d} className="w-2 h-2 rounded-full bg-primary/70 animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
    </span>
  );
}

export function FixQueueLiveChat({ issueId, firstName, reopens, saving, onCancel, onSend }: {
  issueId: number;
  firstName: string;
  reopens: boolean;
  saving: boolean;
  onCancel: () => void;
  /** The instruction for the hourly reviewer, as the old Ask Claude box sent it. */
  onSend: (text: string, fixNow: boolean) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [instruction, setInstruction] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [turns.length]);

  const chat = useMutation({
    mutationFn: (history: Turn[]) => ask(issueId, history, false),
    onSuccess: answer => setTurns(t => [...t, { role: "assistant", text: answer }]),
  });
  const summary = useMutation({
    mutationFn: () => ask(issueId, turns, true),
    onSuccess: draft => setInstruction(draft),
  });

  const send = () => {
    const q = text.trim();
    if (!q || chat.isPending) return;
    const history: Turn[] = [...turns, { role: "user", text: q }];
    setTurns(history);
    setText("");
    chat.mutate(history);
  };
  const answered = turns.some(t => t.role === "assistant");
  const clean = (instruction ?? "").trim();

  return (
    <div className="rounded-2xl border-2 border-primary/40 bg-secondary/30 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <p className="font-bold flex-1 flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> Ask Claude</p>
        <button onClick={onCancel} aria-label="Close" className="p-2 rounded-lg hover:bg-secondary"><X className="w-5 h-5" /></button>
      </div>

      {turns.length === 0 && (
        <p className="text-sm text-muted-foreground">Ask anything about this report. Claude has read it, {firstName}'s chat with Jane and the recommendation, and can look things up in the app's data. It answers here, now.</p>
      )}
      <ol className="space-y-2 max-h-[55dvh] overflow-y-auto pr-1">
        {turns.map((t, i) => (
          <li key={i} className={cn("flex", t.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[88%] rounded-2xl px-4 py-2.5 text-base whitespace-pre-wrap break-words",
              t.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border border-border")}>
              <BoldText text={t.text} />
            </div>
          </li>
        ))}
        {chat.isPending && <li className="flex"><div className="rounded-2xl px-4 py-2 bg-card border border-border"><Thinking /></div></li>}
        <div ref={endRef} />
      </ol>
      {chat.isError && <p className="text-sm text-destructive font-semibold">{(chat.error as Error).message}</p>}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{firstName} doesn't see this chat.</span>
          <DictateButton value={text} onChange={setText} context="note" />
        </div>
        <div className="flex gap-2 items-end">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={2} maxLength={4000} autoFocus
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={answered ? "Ask a follow-up" : "What's going on here?"}
            className="flex-1 px-3 py-2.5 bg-background border-2 border-border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <button onClick={send} disabled={!text.trim() || chat.isPending}
            className={cn("h-11 px-4 rounded-xl font-bold flex items-center gap-2 disabled:opacity-50",
              text.trim() ? "bg-primary text-primary-foreground" : "border-2 border-border bg-card")}>
            {chat.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Ask
          </button>
        </div>
      </div>

      {/* When it's worked out: the message for the hourly reviewer. */}
      {answered && instruction === null && (
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border">
          <button onClick={() => summary.mutate()} disabled={summary.isPending || chat.isPending}
            className="h-11 px-4 mt-2 rounded-xl border-2 border-primary text-primary bg-card font-bold flex items-center gap-2 disabled:opacity-50">
            {summary.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />} Turn this into the fix instruction
          </button>
          <button onClick={() => setInstruction("")} className="h-11 px-3 mt-2 text-sm font-semibold text-muted-foreground underline">Write it myself</button>
          {summary.isError && <span className="text-sm text-destructive font-semibold">{(summary.error as Error).message}</span>}
        </div>
      )}
      {instruction !== null && (
        <div className="space-y-2 pt-2 border-t border-border">
          <p className="text-sm font-bold">For the hourly reviewer (edit anything)</p>
          <textarea value={instruction} onChange={e => setInstruction(e.target.value)} rows={6} maxLength={4000}
            className="w-full px-3 py-2.5 bg-background border-2 border-border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-muted-foreground flex-1 min-w-[12rem]">{firstName} doesn't see this.{reopens ? " It reopens the card." : ""}</p>
            <button onClick={() => onSend(clean, false)} disabled={saving || !clean}
              className="h-11 px-4 rounded-xl bg-secondary border-2 border-border font-bold disabled:opacity-50">Just send</button>
            <button onClick={() => onSend(clean, true)} disabled={saving || !clean}
              className="h-11 px-5 rounded-xl bg-primary text-primary-foreground font-bold flex items-center gap-2 disabled:opacity-50">
              <Wrench className="w-4 h-4" /> Send and fix it this way
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
