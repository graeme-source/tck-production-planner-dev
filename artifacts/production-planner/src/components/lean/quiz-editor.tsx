/**
 * The end-of-week questions on the Lean curriculum week screen, editable in
 * place (Graeme, 23 Nov 2026: "I can't edit the questions in the quiz").
 * Saves itself a moment after each change, with the save state shown; a
 * quiz that can't be answered yet (a blank question, one answer, no right
 * answer ticked) waits, saying what's missing. Rules: @workspace/lean-quiz.
 * Server: PUT /api/lean-curriculum/weeks/:id/quiz.
 */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, CheckCircle2, HelpCircle, Loader2, Plus, Trash2, X } from "lucide-react";
import { checkQuiz, MAX_OPTIONS, MAX_QUESTIONS, type QuizQuestion } from "@workspace/lean-quiz";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const SAVE_DELAY_MS = 800;

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "waiting"; problem: string } | { kind: "error"; message: string };

async function saveQuiz(weekId: number, quiz: QuizQuestion[]): Promise<QuizQuestion[]> {
  const res = await fetch(`${BASE}/api/lean-curriculum/weeks/${weekId}/quiz`, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quiz }),
    keepalive: true, // so a save fired as the screen closes still lands
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Save failed (${res.status})`);
  return (body as { quiz: QuizQuestion[] }).quiz;
}

export function QuizEditor({ weekId, quiz }: { weekId: number; quiz: QuizQuestion[] }) {
  const queryClient = useQueryClient();
  // The draft is the user's from the first render on; the saved copy coming
  // back doesn't overwrite what they're typing.
  const [draft, setDraft] = useState<QuizQuestion[]>(() => quiz.map(q => ({ ...q, options: [...q.options] })));
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<QuizQuestion[] | null>(null);

  const flush = async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const next = pending.current;
    pending.current = null;
    if (!next) return;
    const checked = checkQuiz(next);
    if (!checked.ok) { setState({ kind: "waiting", problem: checked.problem }); return; }
    setState({ kind: "saving" });
    try {
      const saved = await saveQuiz(weekId, checked.quiz);
      if (pending.current) return; // more typing since — that save reports
      setState({ kind: "saved" });
      queryClient.setQueryData<{ quiz: QuizQuestion[] } & Record<string, unknown>>(
        ["lean-curriculum-week", weekId], old => (old ? { ...old, quiz: saved } : old));
      void queryClient.invalidateQueries({ queryKey: ["lean-curriculum"] }); // the week card's quiz count
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  // Closing the screen mid-typing still saves.
  useEffect(() => () => { if (pending.current) void flush(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (next: QuizQuestion[]) => {
    setDraft(next);
    pending.current = next;
    setState({ kind: "idle" });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  };
  const editQ = (qi: number, patch: Partial<QuizQuestion>) =>
    change(draft.map((q, i) => (i === qi ? { ...q, ...patch } : q)));

  return (
    <div className="border border-border rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <HelpCircle className="w-4 h-4 text-primary" /> End-of-week questions
        </p>
        <SaveBadge state={state} />
      </div>

      {draft.length === 0 && (
        <p className="text-xs text-muted-foreground">No questions yet — the weekly review needs at least one.</p>
      )}

      {draft.map((q, qi) => (
        <div key={qi} className="rounded-lg bg-secondary/30 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <span className="text-xs font-semibold text-muted-foreground pt-2.5 w-6 shrink-0">{qi + 1}.</span>
            <textarea
              value={q.question}
              onChange={e => editQ(qi, { question: e.target.value })}
              rows={2}
              placeholder="The question"
              className="flex-1 min-w-0 px-2.5 py-2 bg-background border border-border rounded-lg text-sm font-medium resize-y focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              onClick={() => change(draft.filter((_, i) => i !== qi))}
              aria-label={`Delete question ${qi + 1}`}
              className="h-10 w-10 shrink-0 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <div className="ml-8 space-y-1.5">
            {q.options.map((opt, oi) => {
              const right = oi === q.answer;
              return (
                <div key={oi} className="flex items-center gap-2">
                  <button
                    onClick={() => editQ(qi, { answer: oi })}
                    aria-label={right ? "The right answer" : "Make this the right answer"}
                    title={right ? "The right answer" : "Make this the right answer"}
                    className={cn("h-9 w-9 shrink-0 rounded-full border-2 flex items-center justify-center",
                      right ? "border-emerald-600 bg-emerald-600 text-white" : "border-border text-transparent hover:border-emerald-600")}
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <input
                    value={opt}
                    onChange={e => editQ(qi, { options: q.options.map((o, j) => (j === oi ? e.target.value : o)) })}
                    placeholder={`Answer ${oi + 1}`}
                    className={cn("flex-1 min-w-0 h-9 px-2.5 bg-background border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30",
                      right ? "border-emerald-600 font-medium" : "border-border")}
                  />
                  {q.options.length > 2 && (
                    <button
                      onClick={() => editQ(qi, {
                        options: q.options.filter((_, j) => j !== oi),
                        // keep the tick on the same answer; removing the ticked one clears it
                        answer: oi === q.answer ? -1 : oi < q.answer ? q.answer - 1 : q.answer,
                      })}
                      aria-label={`Remove answer ${oi + 1}`}
                      className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
            {q.options.length < MAX_OPTIONS && (
              <button
                onClick={() => editQ(qi, { options: [...q.options, ""] })}
                className="h-9 px-2 text-xs font-medium text-primary flex items-center gap-1 hover:underline"
              >
                <Plus className="w-3.5 h-3.5" /> Add an answer
              </button>
            )}
          </div>
        </div>
      ))}

      {draft.length < MAX_QUESTIONS && (
        <button
          onClick={() => change([...draft, { question: "", options: ["", ""], answer: -1 }])}
          className="w-full h-11 rounded-lg border-2 border-dashed border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/30 flex items-center justify-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> Add a question
        </button>
      )}
    </div>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  if (state.kind === "saving") return <span className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Saving…</span>;
  if (state.kind === "saved") return <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Saved</span>;
  if (state.kind === "waiting") return <span className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Not saved yet — {state.problem}</span>;
  if (state.kind === "error") return <span className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {state.message}</span>;
  return <span className="text-xs text-muted-foreground">Saves as you type</span>;
}
