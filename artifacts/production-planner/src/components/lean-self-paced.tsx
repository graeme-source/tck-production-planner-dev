/**
 * Self-paced Lean curriculum (Graeme, 2026-09-12): the same weekly modules
 * the team covers in morning meetings, walkable in order at your own pace —
 * built for new starters who want to get ahead before their first day (it
 * renders inside the gated onboarding screen), and equally useful for
 * anyone catching up (mounted at /lean-start for full-access users).
 *
 * Completing a module = reading its pages and getting the quiz fully right;
 * that records the review and ticks the person's Lean training matrix,
 * exactly like the weekly flow. Later weeks stay locked until the earlier
 * ones are done — the curriculum is a journey, not a buffet.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, CheckCircle2, Lock, ChevronLeft, ChevronRight, GraduationCap,
  BookOpen, Headphones, Youtube, ExternalLink, ArrowLeft,
} from "lucide-react";
import { MarkdownBlock, YouTubeEmbed } from "@/components/lesson-media";
import { LessonDiagram } from "@/components/lesson-diagrams";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ModuleSummary {
  id: number;
  week: number;
  title: string;
  summary: string;
  completed: boolean;
  completedAt: string | null;
}

interface ModuleDetail {
  principle: { id: number; title: string; summary: string };
  lessons: Array<{ id: number; title: string; summary: string; whatToShowMd: string | null; diagram: string | null; imageUrl: string | null; videoUrl: string | null }>;
  quiz: Array<{ question: string; options: string[] }>;
  completed: boolean;
}

const RESOURCES: Array<{ label: string; hint: string; href: string; icon: typeof BookOpen }> = [
  { label: "Lean Made Simple — the podcast", hint: "Ryan Tierney — our lean canon, in your ears", href: "https://www.youtube.com/@leanmadesimple/podcasts", icon: Headphones },
  { label: "Lean Made Simple on YouTube", hint: "Factory tours and lean in practice", href: "https://www.youtube.com/@leanmadesimple", icon: Youtube },
  { label: "Lean Made Simple — the book", hint: "Ryan Tierney's 12 steps; the book our curriculum follows", href: "https://www.leanmadesimple.com/", icon: BookOpen },
  { label: "2 Second Lean — free book", hint: "Paul Akers — fix what bugs you, every day", href: "https://paulakers.net/books/2-second-lean", icon: BookOpen },
];

export function LeanResources() {
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      {RESOURCES.map(r => {
        const Icon = r.icon;
        return (
          <a
            key={r.href}
            href={r.href}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl border border-border bg-card p-3 flex items-start gap-3 hover:bg-secondary/40 transition-colors"
          >
            <Icon className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <span className="min-w-0">
              <span className="text-sm font-semibold flex items-center gap-1.5">{r.label} <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0" /></span>
              <span className="block text-xs text-muted-foreground">{r.hint}</span>
            </span>
          </a>
        );
      })}
    </div>
  );
}

export function LeanSelfPaced() {
  const queryClient = useQueryClient();
  const [openModuleId, setOpenModuleId] = useState<number | null>(null);

  const list = useQuery<{ modules: ModuleSummary[]; nextId: number | null }>({
    queryKey: ["lean-self-paced"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/lean-reviews/self-paced`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load the curriculum");
      return res.json();
    },
  });

  if (list.isLoading) {
    return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }
  const modules = list.data?.modules ?? [];
  const nextId = list.data?.nextId ?? null;
  const doneCount = modules.filter(m => m.completed).length;

  if (openModuleId != null) {
    return (
      <ModuleReader
        moduleId={openModuleId}
        onBack={() => {
          setOpenModuleId(null);
          queryClient.invalidateQueries({ queryKey: ["lean-self-paced"] });
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-primary" /> The Lean curriculum
        </p>
        <span className="text-xs font-bold tabular-nums text-muted-foreground">{doneCount}/{modules.length} done</span>
      </div>
      <p className="text-xs text-muted-foreground">
        The same lessons the team covers together, one week at a time. Read each module's pages, get the three
        questions right, and it's ticked off on your training record — work through them in order, as fast or
        slow as you like.
      </p>
      <div className="space-y-1.5">
        {modules.map(m => {
          const isNext = m.id === nextId;
          const locked = !m.completed && !isNext;
          return (
            <button
              key={m.id}
              onClick={() => !locked && setOpenModuleId(m.id)}
              disabled={locked}
              className={cn(
                "w-full text-left rounded-xl border-2 p-3 flex items-center gap-3 transition-colors",
                m.completed ? "border-emerald-500/50 bg-emerald-500/5"
                  : isNext ? "border-primary bg-primary/5 hover:bg-primary/10"
                  : "border-border opacity-60 cursor-not-allowed",
              )}
            >
              <span className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold",
                m.completed ? "bg-emerald-500 text-white" : isNext ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
              )}>
                {m.completed ? <CheckCircle2 className="w-5 h-5" /> : locked ? <Lock className="w-4 h-4" /> : m.week}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold truncate">Week {m.week}: {m.title}</span>
                <span className="block text-xs text-muted-foreground truncate">{m.summary}</span>
              </span>
              {isNext && <span className="text-xs font-bold text-primary flex-shrink-0">Start →</span>}
            </button>
          );
        })}
        {modules.length === 0 && (
          <p className="text-sm text-muted-foreground py-3">The curriculum isn't published yet — check back soon.</p>
        )}
      </div>
    </div>
  );
}

function ModuleReader({ moduleId, onBack }: { moduleId: number; onBack: () => void }) {
  const [pageIdx, setPageIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [lastResult, setLastResult] = useState<{ passed: boolean; correct: number; total: number } | null>(null);

  const { data, isLoading } = useQuery<ModuleDetail>({
    queryKey: ["lean-self-paced-module", moduleId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/lean-reviews/self-paced/module/${moduleId}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to load the module");
      return res.json();
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      const ordered = (data?.quiz ?? []).map((_q, i) => answers[i] ?? -1);
      const res = await fetch(`${BASE}/api/lean-reviews/self-paced/complete`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ principleId: moduleId, answers: ordered }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to submit");
      return res.json() as Promise<{ passed: boolean; correct: number; total: number }>;
    },
    onSuccess: (result) => setLastResult(result),
  });

  if (isLoading) {
    return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }
  if (!data) {
    return (
      <div className="space-y-3">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="w-4 h-4" /> Back to the curriculum</button>
        <p className="text-sm text-muted-foreground">Couldn't load that module.</p>
      </div>
    );
  }

  const lessons = data.lessons;
  const hasQuiz = data.quiz.length > 0;
  const totalPages = lessons.length + (hasQuiz ? 1 : 0);
  const onQuizPage = hasQuiz && pageIdx === totalPages - 1;
  const lesson = onQuizPage ? null : lessons[pageIdx];
  const allAnswered = data.quiz.every((_q, i) => answers[i] != null);
  const passed = lastResult?.passed || data.completed;

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back to the curriculum
      </button>
      <div>
        <h3 className="font-display text-xl font-bold leading-tight">{data.principle.title}</h3>
        <p className="text-sm text-muted-foreground mt-0.5">{data.principle.summary}</p>
        {data.completed && (
          <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4" /> Completed — the pages stay open for another look.
          </p>
        )}
      </div>

      {/* Progress dots */}
      <div className="flex items-center gap-1.5">
        {Array.from({ length: totalPages }, (_, i) => (
          <button
            key={i}
            onClick={() => setPageIdx(i)}
            aria-label={i < lessons.length ? `Page ${i + 1}` : "Quiz"}
            className={cn("h-2 rounded-full transition-all", i === pageIdx ? "w-8 bg-primary" : "w-2 bg-border hover:bg-primary/40")}
          />
        ))}
        <span className="ml-2 text-xs text-muted-foreground">{onQuizPage ? "The quiz" : `Page ${pageIdx + 1} of ${lessons.length}`}</span>
      </div>

      {onQuizPage ? (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-2xl p-4 space-y-5">
            <div className="flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-primary" />
              <h4 className="font-semibold">Quick questions</h4>
            </div>
            {data.quiz.map((q, qi) => (
              <div key={qi}>
                <p className="font-medium mb-2 text-sm">{qi + 1}. {q.question}</p>
                <div className="space-y-1.5">
                  {q.options.map((opt, oi) => (
                    <button
                      key={oi}
                      onClick={() => { setAnswers(a => ({ ...a, [qi]: oi })); setLastResult(null); }}
                      className={cn(
                        "w-full text-left px-4 py-2.5 rounded-xl border text-sm transition-colors",
                        answers[qi] === oi ? "border-primary bg-primary/10 font-semibold" : "border-border hover:border-primary/40 hover:bg-secondary/40",
                      )}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {lastResult && !lastResult.passed && (
            <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
              {lastResult.correct} of {lastResult.total} right — close! Have another look at the pages and try again. Retries are free.
            </div>
          )}
          {passed && (
            <div className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> Full marks — module done, and your training record is ticked.
            </div>
          )}
          {!passed && (
            <button
              onClick={() => submit.mutate()}
              disabled={!allAnswered || submit.isPending}
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {submit.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {allAnswered ? "Check my answers" : "Answer every question to finish"}
            </button>
          )}
          {passed && (
            <button onClick={onBack} className="w-full py-3 rounded-xl border-2 border-primary text-primary font-semibold inline-flex items-center justify-center gap-2">
              Back to the curriculum — next week awaits <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      ) : lesson ? (
        <div className="space-y-3">
          <div className="bg-card border border-border rounded-2xl p-4">
            <h4 className="font-display text-lg font-bold mb-1">{lesson.title}</h4>
            <p className="text-sm text-muted-foreground mb-3">{lesson.summary}</p>
            <MarkdownBlock content={lesson.whatToShowMd ?? ""} />
          </div>
          {lesson.videoUrl && <YouTubeEmbed url={lesson.videoUrl} />}
          {lesson.diagram && <LessonDiagram id={lesson.diagram} />}
          {lesson.imageUrl && <img src={lesson.imageUrl} alt="" className="w-full max-h-72 object-contain rounded-2xl bg-black/5" />}
        </div>
      ) : null}

      {/* Pager */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setPageIdx(i => Math.max(0, i - 1))}
          disabled={pageIdx === 0}
          className="px-4 py-2.5 rounded-xl border border-border text-sm font-medium disabled:opacity-40 inline-flex items-center gap-1.5"
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        {!onQuizPage && (
          <button
            onClick={() => setPageIdx(i => Math.min(totalPages - 1, i + 1))}
            className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5"
          >
            {pageIdx === lessons.length - 1 && hasQuiz ? <>To the quiz <GraduationCap className="w-4 h-4" /></> : <>Next <ChevronRight className="w-4 h-4" /></>}
          </button>
        )}
      </div>
    </div>
  );
}
