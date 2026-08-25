/**
 * The weekly lean lesson review (Objective E — "impossible not to learn",
 * Graeme 2026-08-25).
 *
 * One module per week, the SAME for everyone, in lockstep with the morning
 * meeting: its pages are the week's five meeting lessons (big visual, few
 * words — the meeting is the reminder, this is the reinforcement) and the
 * last page is a three-question quiz. Full marks completes it; retries are
 * free. Completion writes the review, ticks the person's cell on the Lean
 * training matrix, and closes the auto-created weekly to-do.
 *
 * Exports:
 *   - LeanReviewPage   — the module, routed at /lean-review (the weekly
 *     to-do deep-links here)
 *   - LeanWeeklyStrip  — slim reminder banner for Layout + StationLayout;
 *     amber early in the week, red from Thursday, gone once completed
 */
import { useState } from "react";
import { Link, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen, ChevronLeft, ChevronRight, CheckCircle2, Loader2, GraduationCap, Eye, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { LessonDiagram } from "@/components/lesson-diagrams";
import { MarkdownBlock, YouTubeEmbed } from "@/components/lesson-media";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ReviewLesson {
  id: number;
  title: string;
  summary: string;
  whatToShowMd: string;
  diagram: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
}
interface ReviewData {
  weekStart: string;
  principle: { id: number; title: string; summary: string } | null;
  lessons: ReviewLesson[];
  quiz: Array<{ question: string; options: string[]; answer?: number }>;
  completed: boolean;
  completedAt: string | null;
  /** Preview only: the founder can count reviewing-ahead as their own
   *  completion for next week. */
  canSelfComplete?: boolean;
  selfCompleted?: boolean;
}

const QUERY_KEY = ["lean-weekly-review"];

export function useLeanWeeklyReview() {
  return useQuery<ReviewData>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/lean-reviews/current`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load the weekly lesson");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Thursday or later (London-ish: the browser clock is fine for a banner). */
function isLateInWeek(): boolean {
  const dow = (new Date().getDay() + 6) % 7; // Mon=0
  return dow >= 3;
}

export function LeanWeeklyStrip() {
  const { data } = useLeanWeeklyReview();
  if (!data?.principle || data.completed) return null;
  const late = isLateInWeek();
  return (
    <Link
      href="/lean-review"
      className={cn(
        "flex items-center gap-3 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors",
        late
          ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-950/50"
          : "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-950/50",
      )}
    >
      <GraduationCap className="w-4 h-4 flex-shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        This week's lean lesson: <strong>{data.principle.title}</strong>
        {late ? " — due by Friday, don't get caught out" : " — two minutes, due Friday"}
      </span>
      <span className={cn(
        "flex-shrink-0 px-3 py-1 rounded-lg text-xs font-bold",
        late ? "bg-red-600 text-white" : "bg-amber-500 text-white",
      )}>
        Start
      </span>
    </Link>
  );
}

/** Inline video swap for the founder's preview: paste any YouTube URL and
 *  it embeds for that page — the whole point is changing a video without
 *  anyone touching code. Saves through the existing example PUT. */
function VideoSwapBox({ lesson }: { lesson: ReviewLesson }) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState(lesson.videoUrl ?? "");
  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/morning-meetings/examples/${lesson.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: url.trim() || null }),
      });
      if (!res.ok) throw new Error("Failed to save");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lean-week-preview"] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: url.trim() ? "Video updated" : "Video removed" });
    },
    onError: () => toast({ title: "Couldn't save the video", variant: "destructive" }),
  });
  const dirty = (url.trim() || null) !== (lesson.videoUrl ?? null);
  return (
    <div className="rounded-xl border border-dashed border-border p-3 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">This page's video</p>
      <div className="flex gap-2">
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="Paste a YouTube URL — or clear to remove the video"
          className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-border bg-background text-sm"
        />
        <button
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          className="flex-shrink-0 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
        </button>
      </div>
      {dirty && url.trim() && <YouTubeEmbed url={url.trim()} />}
    </div>
  );
}

export function LeanReviewPage() {
  const queryClient = useQueryClient();
  const search = useSearch();
  const isPreview = new URLSearchParams(search).get("week") === "next";
  const { state } = useAuth();
  const canPreview = state.status === "authenticated" && (state.user.role === "admin" || state.user.role === "manager");

  const thisWeek = useLeanWeeklyReview();
  const preview = useQuery<ReviewData>({
    queryKey: ["lean-week-preview"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/lean-reviews/preview`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load next week's lesson");
      const raw = await res.json();
      return { ...raw, completed: false, completedAt: null };
    },
    enabled: isPreview && canPreview,
  });
  const { data, isLoading } = isPreview ? preview : thisWeek;
  const [pageIdx, setPageIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [lastResult, setLastResult] = useState<{ passed: boolean; correct: number; total: number } | null>(null);

  // Founder review-ahead: reviewing next week counts as their completion
  // for next week — same rules as everyone, a week early.
  const previewComplete = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/lean-reviews/preview/complete`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Failed to record the review");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lean-week-preview"] });
      queryClient.invalidateQueries({ queryKey: ["todos"] });
      toast({ title: "Next week counted as done for you", description: "Matrix ticked, to-do closed." });
    },
    onError: () => toast({ title: "Couldn't record the review", variant: "destructive" }),
  });

  const submit = useMutation({
    mutationFn: async () => {
      const ordered = (data?.quiz ?? []).map((_q, i) => answers[i] ?? -1);
      const res = await fetch(`${BASE}/api/lean-reviews/complete`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: ordered }),
      });
      if (!res.ok) throw new Error("Failed to submit");
      return res.json() as Promise<{ passed: boolean; correct: number; total: number }>;
    },
    onSuccess: result => {
      setLastResult(result);
      if (result.passed) {
        queryClient.invalidateQueries({ queryKey: QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: ["todos"] });
      }
    },
  });

  if (isLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!data?.principle) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center text-muted-foreground">
        <GraduationCap className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p className="font-medium">
          {isPreview ? "No lean focus is set for next week yet." : "No lean focus is set for this week yet."}
        </p>
      </div>
    );
  }

  const lessons = data.lessons;
  const hasQuiz = data.quiz.length > 0;
  const totalPages = lessons.length + (hasQuiz ? 1 : 0);
  const onQuizPage = hasQuiz && pageIdx === totalPages - 1;
  const lesson = onQuizPage ? null : lessons[pageIdx];
  const allAnswered = data.quiz.every((_q, i) => answers[i] != null);

  return (
    <div key={isPreview ? "preview" : "this-week"} className="max-w-3xl mx-auto space-y-5 pb-16">
      {/* Header */}
      <div>
        <p className={cn("text-xs font-semibold uppercase tracking-wide mb-1", isPreview ? "text-amber-600" : "text-purple-500")}>
          {isPreview ? "Preview — next week's lesson" : "This week's lean lesson"}
        </p>
        <h1 className="font-display text-3xl font-bold leading-tight">{data.principle.title}</h1>
        <p className="text-muted-foreground mt-1">{data.principle.summary}</p>
        {isPreview && (
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            This is what the whole team sees from Monday. Review it, swap any video by pasting a URL, and the quiz
            answers are shown so you can sanity-check them — nothing here counts as your own weekly review.
          </p>
        )}
        {!isPreview && data.completed && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4" /> Completed this week — nice one. The pages stay open for another look.
          </p>
        )}
        {canPreview && (
          <p className="mt-2">
            <Link
              href={isPreview ? "/lean-review" : "/lean-review?week=next"}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              <Eye className="w-4 h-4" />
              {isPreview ? "Back to this week's lesson" : "Preview next week's lesson"}
            </Link>
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
            className={cn(
              "h-2 rounded-full transition-all",
              i === pageIdx ? "w-8 bg-primary" : "w-2 bg-border hover:bg-primary/40",
            )}
          />
        ))}
        <span className="ml-2 text-xs text-muted-foreground">
          {onQuizPage ? "The quiz" : `Page ${pageIdx + 1} of ${lessons.length}`}
        </span>
      </div>

      {onQuizPage ? (
        <div className="space-y-5">
          <div className="bg-card border border-border rounded-2xl p-5 space-y-6">
            <div className="flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-primary" />
              <h2 className="font-semibold text-lg">Three quick questions</h2>
            </div>
            {data.quiz.map((q, qi) => (
              <div key={qi}>
                <p className="font-medium mb-2">{qi + 1}. {q.question}</p>
                <div className="space-y-1.5">
                  {q.options.map((opt, oi) => (
                    isPreview ? (
                      <div
                        key={oi}
                        className={cn(
                          "w-full text-left px-4 py-2.5 rounded-xl border text-sm flex items-center justify-between gap-2",
                          q.answer === oi
                            ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 font-semibold"
                            : "border-border",
                        )}
                      >
                        <span>{opt}</span>
                        {q.answer === oi && (
                          <span className="flex-shrink-0 text-xs font-bold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> correct answer
                          </span>
                        )}
                      </div>
                    ) : (
                      <button
                        key={oi}
                        onClick={() => { setAnswers(a => ({ ...a, [qi]: oi })); setLastResult(null); }}
                        className={cn(
                          "w-full text-left px-4 py-2.5 rounded-xl border text-sm transition-colors",
                          answers[qi] === oi
                            ? "border-primary bg-primary/10 font-semibold"
                            : "border-border hover:border-primary/40 hover:bg-secondary/40",
                        )}
                      >
                        {opt}
                      </button>
                    )
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
          {(lastResult?.passed || data.completed) && (
            <div className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> Full marks — you're done for the week. Your Lean training matrix has been ticked.
            </div>
          )}

          {!isPreview && !data.completed && !lastResult?.passed && (
            <button
              onClick={() => submit.mutate()}
              disabled={!allAnswered || submit.isPending}
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {submit.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {allAnswered ? "Check my answers" : "Answer all three to finish"}
            </button>
          )}

          {isPreview && data.canSelfComplete && (
            data.selfCompleted ? (
              <div className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Next week is already counted as done for you.
              </div>
            ) : (
              <button
                onClick={() => previewComplete.mutate()}
                disabled={previewComplete.isPending}
                className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {previewComplete.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                I've reviewed next week — count it as my completion
              </button>
            )
          )}
        </div>
      ) : lesson ? (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-2xl p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][pageIdx] ?? `Part ${pageIdx + 1}`}'s angle
            </p>
            <h2 className="font-display text-xl font-bold mb-1">{lesson.title}</h2>
            <p className="text-sm text-muted-foreground mb-4">{lesson.summary}</p>
            <MarkdownBlock content={lesson.whatToShowMd} />
          </div>
          {lesson.videoUrl && <YouTubeEmbed url={lesson.videoUrl} />}
          {isPreview && <VideoSwapBox key={lesson.id} lesson={lesson} />}
          {lesson.diagram && <LessonDiagram id={lesson.diagram} />}
          {lesson.imageUrl && (
            <img src={lesson.imageUrl} alt="" className="w-full max-h-80 object-contain rounded-2xl bg-black/5" />
          )}
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

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <BookOpen className="w-3.5 h-3.5" />
        {isPreview
          ? "This module goes live for the whole team on Monday, alongside that week's morning meetings."
          : "The same lesson everyone's covering in this week's morning meetings — the meeting shows it, this checks it stuck."}
      </p>
    </div>
  );
}
