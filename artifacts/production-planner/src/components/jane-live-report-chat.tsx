/**
 * Talk to AI Jane before reporting (Graeme, 20 Nov 2026: "force people to
 * have the conversation with AI Jane first, to see if she can fix it without
 * it coming to my desk … then build an issue report based on the findings").
 * Jane answers live, can point at an SOP or a page, and asks whether it's
 * sorted. "That sorted it" ends it with no report; "Write my report" turns
 * the chat into the report for the person to check and send. Safety never
 * waits: "Safety problem — report it now" goes straight to the form.
 * Server: POST /api/report-chat/live, /live/report, /live/resolved.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import { BookOpen, CheckCircle2, ExternalLink, FileText, Loader2, Send, ShieldAlert } from "lucide-react";
import { JaneAvatar } from "@/components/jane-avatar";
import { DictateButton } from "@/components/dictate-button";
import { BoldText } from "@/components/bold-text";
import { StandardsSopsDialog } from "@/components/standards-sops-dialog";
import type { JaneTurn } from "@/components/jane-report-check";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Area = "factory" | "system";
interface LiveReply { message: string; sops: Array<{ id: number; title: string }>; path: string | null; issueId: number | null }
type Shown = JaneTurn & { reply?: LiveReply };

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api/report-chat${path}`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? `Request failed (${res.status})`);
  return out as T;
}

function Thinking() {
  return (
    <span className="flex items-center gap-1 py-1" role="status" aria-label="Jane is thinking">
      {[0, 150, 300].map(d => <span key={d} className="w-2 h-2 rounded-full bg-primary/70 animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
    </span>
  );
}

export function JaneLiveReportChat({ area, onSorted, onWriteReport, onSafety, onOpenPath }: {
  area: Area;
  /** Jane sorted it: nothing is reported. */
  onSorted: () => void;
  /** The report Jane wrote from the chat, and the chat itself. */
  onWriteReport: (draft: string, transcript: JaneTurn[]) => void;
  /** Safety: straight to the report form. */
  onSafety: () => void;
  onOpenPath: (path: string) => void;
}) {
  const [turns, setTurns] = useState<Shown[]>([]);
  const [text, setText] = useState("");
  const [sopId, setSopId] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [turns.length]);

  const history = (list: Shown[]): JaneTurn[] => list.map(t => ({ role: t.role, text: t.text }));

  const ask = useMutation({
    mutationFn: (list: Shown[]) => post<{ reply: LiveReply }>("/live", { area, history: history(list) }),
    onSuccess: ({ reply }) => setTurns(t => [...t, { role: "assistant", text: reply.message, reply }]),
  });
  const write = useMutation({
    mutationFn: () => post<{ draft: string }>("/live/report", { area, history: history(turns) }),
    onSuccess: ({ draft }) => onWriteReport(draft, history(turns)),
  });
  const sorted = useMutation({
    mutationFn: () => post("/live/resolved", { area, history: history(turns) }),
    onSettled: () => onSorted(),
  });

  const send = () => {
    const q = text.trim();
    if (!q || ask.isPending) return;
    const next: Shown[] = [...turns, { role: "user", text: q }];
    setTurns(next);
    setText("");
    ask.mutate(next);
  };
  const talked = turns.some(t => t.role === "assistant");
  const busy = ask.isPending || write.isPending || sorted.isPending;

  return (
    <div className="space-y-3">
      <button onClick={onSafety}
        className="w-full h-12 rounded-2xl border-2 border-destructive/60 text-destructive font-bold flex items-center justify-center gap-2 hover:bg-destructive/10">
        <ShieldAlert className="w-5 h-5" /> Safety problem? Report it now
      </button>

      <div className="flex gap-3 items-start">
        <JaneAvatar className="w-9 h-9 flex-shrink-0" />
        <div className="rounded-2xl bg-card border border-border px-4 py-3 text-base">
          {area === "system"
            ? "Hi, I'm AI Jane. Tell me what's going wrong in the app and I'll see if we can sort it now. If we can't, I'll write the report for you."
            : "Hi, I'm AI Jane. Tell me what the problem is and where, and I'll see if we can sort it now. If we can't, I'll write the report for you."}
        </div>
      </div>

      <ol className="space-y-3 max-h-[45dvh] overflow-y-auto pr-1">
        {turns.map((t, i) => (
          <li key={i} className={cn("flex gap-3", t.role === "user" ? "justify-end" : "items-start")}>
            {t.role === "assistant" && <JaneAvatar className="w-9 h-9 flex-shrink-0" />}
            <div className={cn("max-w-[85%] rounded-2xl px-4 py-3 text-base whitespace-pre-wrap break-words",
              t.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border border-border")}>
              <BoldText text={t.text} />
              {t.reply && (t.reply.sops.length > 0 || t.reply.path) && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {t.reply.sops.map(s => (
                    <button key={s.id} onClick={() => setSopId(s.id)}
                      className="h-10 px-3 rounded-xl border-2 border-primary/50 text-primary font-semibold text-sm flex items-center gap-1.5 bg-background">
                      <BookOpen className="w-4 h-4" /> {s.title}
                    </button>
                  ))}
                  {t.reply.path && (
                    <button onClick={() => onOpenPath(t.reply!.path!)}
                      className="h-10 px-3 rounded-xl border-2 border-primary/50 text-primary font-semibold text-sm flex items-center gap-1.5 bg-background">
                      <ExternalLink className="w-4 h-4" /> Take me there
                    </button>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
        {ask.isPending && <li className="flex gap-3 items-start"><JaneAvatar className="w-9 h-9 flex-shrink-0" /><div className="rounded-2xl px-4 py-2 bg-card border border-border"><Thinking /></div></li>}
        <div ref={endRef} />
      </ol>
      {ask.isError && <p className="text-sm text-destructive font-semibold">{(ask.error as Error).message}</p>}
      {write.isError && <p className="text-sm text-destructive font-semibold">{(write.error as Error).message}</p>}

      <div className="space-y-2">
        <textarea value={text} onChange={e => setText(e.target.value)} rows={2} maxLength={4000} autoFocus
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={talked ? "Reply to Jane" : area === "system" ? "What were you doing, and what happened?" : "What's the problem, and where?"}
          className="w-full px-4 py-3 rounded-2xl border-2 border-border bg-card text-lg focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y" />
        <div className="flex items-center gap-2">
          <DictateButton value={text} onChange={setText} context="note" />
          <button onClick={send} disabled={!text.trim() || busy}
            className={cn("ml-auto h-12 px-5 rounded-2xl font-bold flex items-center gap-2 disabled:opacity-50",
              text.trim() ? "bg-primary text-primary-foreground" : "border-2 border-border bg-card")}>
            {ask.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />} Send
          </button>
        </div>
      </div>

      {/* Once Jane has answered: sorted, or write it up. If she can't
          answer, writing it up is always there — nobody gets stuck. */}
      {(talked || (ask.isError && turns.length > 0)) && (
        <div className={cn("grid grid-cols-1 gap-3 pt-2 border-t border-border", talked && "sm:grid-cols-2")}>
          {talked && (
            <button onClick={() => sorted.mutate()} disabled={busy}
              className="h-14 rounded-2xl border-2 border-emerald-500 text-emerald-700 dark:text-emerald-300 bg-card text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
              {sorted.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />} That sorted it
            </button>
          )}
          <button onClick={() => write.mutate()} disabled={busy}
            className="h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
            {write.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5" />} {write.isPending ? "Writing it up…" : "Write my report"}
          </button>
        </div>
      )}

      {/* Above the report window (z-150): the SOP dialog's own layers are
          40–50, so it's lifted in a stacking context of its own. */}
      {sopId != null && createPortal(
        <div className="relative z-[200]">
          <StandardsSopsDialog open onClose={() => setSopId(null)} initialSopId={sopId} />
        </div>,
        document.body,
      )}
    </div>
  );
}
