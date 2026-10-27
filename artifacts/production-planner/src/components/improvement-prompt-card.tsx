/**
 * "Have you made an improvement today?" — the big friendly card for the
 * optional last item on every closing checklist (Graeme, 27 Oct 2026;
 * Objectives E and H).
 *
 *   Yes → the normal Record Improvement form (as "something you've done",
 *         at this station, with you credited). Saving it records the yes.
 *         If you've already logged one today, you can count that instead.
 *   No  → recorded straight away, with an upbeat "tomorrow's another chance".
 *
 * Answered per PERSON per day (whoever's signed in), saved the moment a
 * button is pressed, and changeable. Never blocks the checklist.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Lightbulb, Loader2, Plus, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { guardedFetch } from "@/hooks/use-guarded-action";
import { useAuth } from "@/contexts/auth-context";
import { RecordImprovementModal } from "@/components/record-improvement-modal";
import { PROMPT_COPY, type PromptToday } from "@/lib/improvement-prompt";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function ImprovementPromptCard({ stationType, planId, templateId, onAnswered }: {
  stationType: string;
  planId: number;
  templateId: number;
  onAnswered: () => void;
}) {
  const qc = useQueryClient();
  const { state } = useAuth();
  const userId = state.status === "authenticated" ? state.user.id : null;
  const queryKey = ["improvement-prompt-today", userId];

  const today = useQuery<PromptToday>({
    queryKey,
    enabled: userId != null,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/improvement-prompt/today`, { credentials: "include" });
      if (!r.ok) throw new Error("Couldn't load today's answer");
      return r.json();
    },
  });

  const [formOpen, setFormOpen] = useState(false);
  const [choosingYes, setChoosingYes] = useState(false);
  const [changing, setChanging] = useState(false);

  const save = useMutation({
    mutationFn: async (body: { answer: "yes" | "no"; improvementId?: number }) => {
      await guardedFetch(`${BASE}/api/improvement-prompt/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, stationType, planId, templateId }),
      });
      return body.answer;
    },
    onSuccess: answer => {
      setChoosingYes(false);
      setChanging(false);
      qc.invalidateQueries({ queryKey: ["improvement-prompt-today"] });
      qc.invalidateQueries({ queryKey: ["improvement-prompt-uptake"] });
      onAnswered();
      toast({ title: answer === "yes" ? PROMPT_COPY.yesDone : PROMPT_COPY.noDone });
    },
    onError: (e: Error) => toast({ title: "Couldn't save your answer", description: e.message, variant: "destructive" }),
  });

  const answer = today.data?.answer ?? null;
  const loggedToday = today.data?.loggedToday ?? [];
  const asking = !answer || changing;

  const onYes = () => {
    // Already logged something today? Offer to count it rather than make
    // them log the same thing twice.
    if (loggedToday.length > 0) setChoosingYes(true);
    else setFormOpen(true);
  };

  return (
    <div className="mt-2 space-y-4">
      {asking ? (
        <div className="rounded-3xl border-2 border-primary/40 bg-primary/5 p-5 space-y-4">
          <div className="flex items-start gap-3">
            <Lightbulb className="w-9 h-9 text-amber-500 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-2xl font-bold leading-snug">{PROMPT_COPY.question}</p>
              <p className="text-base text-muted-foreground mt-1">
                Big or small — moving a tool, a better label, a quicker way. {PROMPT_COPY.optional}
              </p>
            </div>
          </div>

          {choosingYes ? (
            <div className="space-y-3">
              <p className="text-base font-semibold">You've logged {loggedToday.length === 1 ? "one" : "some"} today already — count it?</p>
              {loggedToday.map(i => (
                <button
                  key={i.id}
                  onClick={() => save.mutate({ answer: "yes", improvementId: i.id })}
                  disabled={save.isPending}
                  className="w-full rounded-2xl border-2 border-emerald-500 bg-card p-4 text-left flex items-center gap-3 disabled:opacity-50 active:scale-[0.99] transition-all"
                >
                  <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0" />
                  <span className="text-lg font-bold min-w-0 break-words">{i.title}</span>
                </button>
              ))}
              <button
                onClick={() => setFormOpen(true)}
                disabled={save.isPending}
                className="w-full h-14 rounded-2xl border-2 border-border bg-card text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Plus className="w-5 h-5" /> No — log a new one
              </button>
              <button
                onClick={() => setChoosingYes(false)}
                className="w-full text-base font-medium text-muted-foreground underline underline-offset-2 py-2"
              >
                Back
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={onYes}
                disabled={save.isPending}
                className="h-20 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-2xl font-bold flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 active:scale-[0.99] transition-all"
              >
                <ThumbsUp className="w-7 h-7" /> Yes
              </button>
              <button
                onClick={() => save.mutate({ answer: "no" })}
                disabled={save.isPending}
                className="h-20 rounded-2xl border-2 border-border bg-card hover:bg-secondary/50 text-2xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.99] transition-all"
              >
                {save.isPending && save.variables?.answer === "no" ? <Loader2 className="w-7 h-7 animate-spin" /> : null}
                No
              </button>
            </div>
          )}

          {changing && (
            <button
              onClick={() => { setChanging(false); setChoosingYes(false); }}
              className="w-full text-base font-medium text-muted-foreground underline underline-offset-2 py-2"
            >
              Keep my answer
            </button>
          )}

          <p className={cn("text-sm text-center", save.isError ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
            {save.isPending ? "Saving…" : save.isError ? "Not saved — tap again" : "Saves as soon as you tap"}
          </p>
        </div>
      ) : answer.answer === "yes" ? (
        <div className="rounded-3xl border-2 border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 p-5 space-y-2">
          <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{PROMPT_COPY.yesDone}</p>
          {answer.improvementTitle && <p className="text-lg font-semibold break-words">{answer.improvementTitle}</p>}
          <p className="text-sm text-muted-foreground">Saved {new Date(answer.answeredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
          <button onClick={() => setChanging(true)} className="text-base font-medium text-muted-foreground underline underline-offset-2 py-2">
            Change my answer
          </button>
        </div>
      ) : (
        <div className="rounded-3xl border-2 border-sky-300 bg-sky-50 dark:bg-sky-950/30 p-5 space-y-3">
          <p className="text-2xl font-bold text-sky-800 dark:text-sky-200">{PROMPT_COPY.noDone}</p>
          <p className="text-sm text-muted-foreground">Saved {new Date(answer.answeredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
          <button
            onClick={() => { setChanging(true); onYes(); }}
            className="w-full h-14 rounded-2xl border-2 border-emerald-500 bg-card text-lg font-bold flex items-center justify-center gap-2"
          >
            <ThumbsUp className="w-5 h-5 text-emerald-600" /> Actually, I did — log it
          </button>
        </div>
      )}

      <RecordImprovementModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        station={stationType}
        initialMode="done"
        onSaved={id => save.mutate({ answer: "yes", improvementId: id })}
      />
    </div>
  );
}
