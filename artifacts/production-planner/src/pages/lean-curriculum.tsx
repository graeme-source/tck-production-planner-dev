// Lean Curriculum planner (Objective E — Graeme, 2026-08-26).
//
// The page for deciding what the team learns, and in what order. Two halves:
//
//   The plan   — the weeks in teaching order, drag to re-order. Each week
//                shows whether it's actually ready: five lessons, a quiz,
//                and how many days carry a video. Draft weeks never reach a
//                morning meeting; locking one in is what puts it live.
//   The backlog — every lean subject we could teach, from the verified
//                corpus. Drop one into the plan, saying how many weeks it
//                needs (3S becomes four: the idea, then each S).
//
// The curriculum is the single source of truth: the Lean training matrix
// re-shapes itself to match on every change, server-side, so the two can
// never drift apart.
//
// Manager/admin only (API is behind requireAdminOrManager).

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext, closestCenter, type DragEndEvent, PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical, Plus, Trash2, Loader2, Sparkles, Lock, Unlock, BookOpen,
  Video, HelpCircle, FileText, RotateCcw, X, Check,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useEffect, useRef } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

type Week = {
  id: number;
  weekPosition: number;
  title: string;
  summary: string;
  status: "draft" | "locked";
  isActive: boolean;
  subjectId: number | null;
  partLabel: string | null;
  partIndex: number | null;
  lessonCount: number;
  videoCount: number;
  quizCount: number;
  matrixLabel: string;
};

type Subject = {
  id: number;
  title: string;
  nutshell: string;
  source: "waste" | "concept" | "step" | "custom";
  audience: "team" | "leaders";
  defaultWeeks: number;
  suggestedParts: string[] | null;
};

type PlannerData = { weeks: Week[]; subjects: Subject[] };

type Lesson = {
  id: number;
  orderPosition: number;
  title: string;
  summary: string;
  explanationMd: string;
  whatToShowMd: string;
  deliveryNotesMd: string;
  videoUrl: string | null;
};

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

export default function LeanCurriculumPage() {
  const queryClient = useQueryClient();
  const [reviewWeekId, setReviewWeekId] = useState<number | null>(null);
  const [addingSubject, setAddingSubject] = useState<Subject | null>(null);
  const [audience, setAudience] = useState<"team" | "leaders">("team");

  const { data, isLoading } = useQuery<PlannerData>({
    queryKey: ["lean-curriculum"],
    queryFn: () => api<PlannerData>("/lean-curriculum"),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["lean-curriculum"] });
    // The matrix re-shapes itself server-side on every change, so anything
    // showing it is stale the moment the plan moves.
    queryClient.invalidateQueries({ queryKey: ["training-matrices"] });
    queryClient.invalidateQueries({ queryKey: ["lean-principles"] });
  };

  const reorder = useMutation({
    mutationFn: (orderedIds: number[]) =>
      api("/lean-curriculum/weeks/order", { method: "PUT", body: JSON.stringify({ orderedIds }) }),
    onSuccess: invalidate,
    onError: (e: Error) => { toast({ title: "Couldn't save the new order", description: e.message, variant: "destructive" }); invalidate(); },
  });

  const removeWeek = useMutation({
    mutationFn: (id: number) => api(`/lean-curriculum/weeks/${id}`, { method: "DELETE" }),
    onSuccess: (res: any) => {
      invalidate();
      if (res?.keptAsHistory?.length) {
        toast({
          title: "Week removed from the plan",
          description: "Its training-matrix column was kept — people had already been signed off on it, and that record shouldn't disappear.",
        });
      }
    },
    onError: (e: Error) => toast({ title: "Couldn't remove the week", description: e.message, variant: "destructive" }),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const weeks = data?.weeks ?? [];
  const subjects = (data?.subjects ?? []).filter(s => s.audience === audience);

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = weeks.findIndex(w => w.id === active.id);
    const newIndex = weeks.findIndex(w => w.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(weeks, oldIndex, newIndex);
    // Optimistic: the list snaps immediately, the server confirms.
    queryClient.setQueryData<PlannerData>(["lean-curriculum"], old =>
      old ? { ...old, weeks: reordered.map((w, i) => ({ ...w, weekPosition: i + 1 })) } : old);
    reorder.mutate(reordered.map(w => w.id));
  };

  const liveWeeks = weeks.filter(w => w.status === "locked").length;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <PageHeader
        title="Lean Curriculum"
        description="What the team learns, in what order. Drag to re-order; only locked weeks reach the morning meeting."
      />

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary/50" /></div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* ── The plan ───────────────────────────────────────────────── */}
          <section className="space-y-3 min-w-0">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-primary" /> The plan
              </h2>
              <p className="text-xs text-muted-foreground">
                {liveWeeks} {liveWeeks === 1 ? "week" : "weeks"} ready to teach
                {weeks.length > liveWeeks && ` · ${weeks.length - liveWeeks} in draft`}
              </p>
            </div>

            {weeks.length === 0 ? (
              <p className="text-sm text-muted-foreground border border-dashed border-border rounded-xl p-6 text-center">
                Nothing planned yet. Add a subject from the backlog to start building the curriculum.
              </p>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={weeks.map(w => w.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {weeks.map((week, i) => (
                      <SortableWeekCard
                        key={week.id}
                        week={week}
                        index={i}
                        onReview={() => setReviewWeekId(week.id)}
                        onRemove={() => removeWeek.mutate(week.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}

            {liveWeeks > 0 && (
              <p className="text-xs text-muted-foreground border-t border-dashed border-border pt-3 flex items-start gap-2">
                <RotateCcw className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  After the last ready week the curriculum starts again at the top. Add more weeks
                  before then if you don't want the team repeating {weeks.find(w => w.status === "locked")?.title}.
                </span>
              </p>
            )}
          </section>

          {/* ── The backlog ────────────────────────────────────────────── */}
          <section className="space-y-3 min-w-0">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" /> Backlog
            </h2>

            <div className="flex gap-1 p-1 bg-secondary/50 rounded-lg">
              {(["team", "leaders"] as const).map(a => (
                <button
                  key={a}
                  onClick={() => setAudience(a)}
                  className={cn(
                    "flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors",
                    audience === a ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {a === "team" ? "For the team" : "For leaders"}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {audience === "team"
                ? "What a colleague needs to learn to work the lean way — seeing waste, making improvements, the concepts behind them."
                : "The parts of Lean Made Simple aimed at whoever is running the transformation. Useful for a supervisor group; not what we teach on the floor."}
            </p>

            <div className="space-y-2">
              {subjects.map(subject => (
                <SubjectCard key={subject.id} subject={subject} onAdd={() => setAddingSubject(subject)} />
              ))}
            </div>

            <NewSubjectForm audience={audience} onCreated={invalidate} />
          </section>
        </div>
      )}

      {addingSubject && (
        <AddToPlanDialog
          subject={addingSubject}
          onClose={() => setAddingSubject(null)}
          onAdded={() => { setAddingSubject(null); invalidate(); }}
        />
      )}

      {reviewWeekId != null && (
        <WeekReviewDialog
          weekId={reviewWeekId}
          onClose={() => setReviewWeekId(null)}
          onChanged={invalidate}
        />
      )}
    </div>
  );
}

// ─── A week in the plan ───────────────────────────────────────────────────────

function SortableWeekCard({ week, index, onReview, onRemove }: {
  week: Week; index: number; onReview: () => void; onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: week.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const ready = week.lessonCount >= 5 && week.quizCount > 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "bg-card border border-border rounded-xl p-3 flex items-start gap-3",
        isDragging && "opacity-60 shadow-lg z-10 relative",
        week.status === "draft" && "border-dashed",
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="mt-0.5 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none flex-shrink-0"
        aria-label={`Re-order ${week.matrixLabel}`}
      >
        <GripVertical className="w-4 h-4" />
      </button>

      <span className="mt-0.5 w-6 h-6 rounded-md bg-secondary text-xs font-semibold flex items-center justify-center flex-shrink-0">
        {index + 1}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-sm truncate">{week.matrixLabel}</p>
          <span className={cn(
            "text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide",
            week.status === "locked" ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600",
          )}>
            {week.status === "locked" ? "Live" : "Draft"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{week.summary}</p>

        <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground flex-wrap">
          <span className={cn("flex items-center gap-1", week.lessonCount >= 5 ? "text-emerald-600" : "")}>
            <FileText className="w-3 h-3" /> {week.lessonCount}/5 lessons
          </span>
          <span className="flex items-center gap-1">
            <Video className="w-3 h-3" /> {week.videoCount === 0 ? "no video" : `${week.videoCount} video${week.videoCount === 1 ? "" : "s"}`}
          </span>
          <span className={cn("flex items-center gap-1", week.quizCount > 0 ? "text-emerald-600" : "")}>
            <HelpCircle className="w-3 h-3" /> {week.quizCount} quiz
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onReview}
          className="px-2.5 py-1.5 rounded-lg bg-secondary hover:bg-secondary/70 text-xs font-medium transition-colors"
        >
          {ready ? "Review" : "Write"}
        </button>
        <button
          onClick={onRemove}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          aria-label={`Remove ${week.matrixLabel} from the plan`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Backlog ──────────────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<Subject["source"], string> = {
  waste: "One of the 8 wastes",
  concept: "Core concept",
  step: "One of the 12 steps",
  custom: "Added by us",
};

function SubjectCard({ subject, onAdd }: { subject: Subject; onAdd: () => void }) {
  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-sm">{subject.title}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{SOURCE_LABEL[subject.source]}</p>
        </div>
        <button
          onClick={onAdd}
          className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
        >
          <Plus className="w-3 h-3" /> Plan
        </button>
      </div>
      <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{subject.nutshell}</p>
    </div>
  );
}

function NewSubjectForm({ audience, onCreated }: { audience: "team" | "leaders"; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [nutshell, setNutshell] = useState("");

  const create = useMutation({
    mutationFn: () => api("/lean-curriculum/subjects", {
      method: "POST",
      body: JSON.stringify({ title: title.trim(), nutshell: nutshell.trim(), audience }),
    }),
    onSuccess: () => { setTitle(""); setNutshell(""); setOpen(false); onCreated(); },
    onError: (e: Error) => toast({ title: "Couldn't add the subject", description: e.message, variant: "destructive" }),
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full py-2 rounded-xl border border-dashed border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors inline-flex items-center justify-center gap-1.5"
      >
        <Plus className="w-3.5 h-3.5" /> Add your own subject
      </button>
    );
  }

  const inputCls = "w-full px-2.5 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <div className="border border-border rounded-xl p-3 space-y-2">
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Subject name, e.g. Respect for people" className={inputCls} />
      <textarea
        value={nutshell}
        onChange={e => setNutshell(e.target.value)}
        placeholder="One or two lines on what it means — this is the brief the lessons get written from."
        rows={3}
        className={cn(inputCls, "resize-y")}
      />
      <div className="flex gap-2">
        <button
          onClick={() => create.mutate()}
          disabled={!title.trim() || !nutshell.trim() || create.isPending}
          className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
        >
          {create.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Add
        </button>
        <button onClick={() => setOpen(false)} className="px-3 py-2 rounded-lg bg-secondary text-xs font-medium">Cancel</button>
      </div>
    </div>
  );
}

// ─── Dropping a subject into the plan ─────────────────────────────────────────

function AddToPlanDialog({ subject, onClose, onAdded }: {
  subject: Subject; onClose: () => void; onAdded: () => void;
}) {
  const [weeks, setWeeks] = useState(subject.defaultWeeks);
  const [parts, setParts] = useState<string[]>(subject.suggestedParts ?? []);

  // A multi-week subject opens with an overview week, then one week per part.
  const partsNeeded = Math.max(0, weeks - 1);
  const partValues = Array.from({ length: partsNeeded }, (_, i) => parts[i] ?? "");

  const add = useMutation({
    mutationFn: () => api("/lean-curriculum/weeks", {
      method: "POST",
      body: JSON.stringify({
        subjectId: subject.id,
        weeks,
        parts: partValues.map((p, i) => p.trim() || `Part ${i + 1}`),
      }),
    }),
    onSuccess: onAdded,
    onError: (e: Error) => toast({ title: "Couldn't add it to the plan", description: e.message, variant: "destructive" }),
  });

  const inputCls = "w-full px-2.5 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Plan &ldquo;{subject.title}&rdquo;</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{subject.nutshell}</p>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">How many weeks does it need?</label>
            <div className="flex gap-1.5 flex-wrap">
              {[1, 2, 3, 4, 5, 6].map(n => (
                <button
                  key={n}
                  onClick={() => setWeeks(n)}
                  className={cn(
                    "w-10 h-10 rounded-lg text-sm font-medium transition-colors border",
                    weeks === n ? "bg-primary text-primary-foreground border-primary" : "bg-secondary border-transparent hover:bg-secondary/70",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {partsNeeded > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Week 1 introduces {subject.title} as a whole. Name what each week after it covers:
              </p>
              {partValues.map((value, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-14 flex-shrink-0">Week {i + 2}</span>
                  <input
                    value={value}
                    onChange={e => {
                      const next = [...partValues];
                      next[i] = e.target.value;
                      setParts(next);
                    }}
                    placeholder={`Part ${i + 1}`}
                    className={inputCls}
                  />
                </div>
              ))}
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            {weeks === 1 ? "One week" : `${weeks} weeks`} will be added to the end of the plan as drafts.
            Nothing reaches the team until you write the lessons and lock each week in.
          </p>

          <button
            onClick={() => add.mutate()}
            disabled={add.isPending}
            className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-medium text-sm disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {add.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add to the plan
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Writing, reviewing and locking a week ────────────────────────────────────

function WeekReviewDialog({ weekId, onClose, onChanged }: {
  weekId: number; onClose: () => void; onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");

  const { data, isLoading } = useQuery<{ week: Week; lessons: Lesson[]; quiz: Array<{ question: string; options: string[]; answer: number }> }>({
    queryKey: ["lean-curriculum-week", weekId],
    queryFn: () => api(`/lean-curriculum/weeks/${weekId}`),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["lean-curriculum-week", weekId] });
    onChanged();
  };

  const generate = useMutation({
    mutationFn: () => api<{ videoWanted: Array<{ day: number; title: string; rationale: string | null }> }>(
      `/lean-curriculum/weeks/${weekId}/generate`,
      { method: "POST", body: JSON.stringify({ notes: notes.trim() || undefined, force: true }) },
    ),
    onSuccess: (res) => {
      refresh();
      setNotes("");
      const wanted = res?.videoWanted ?? [];
      toast({
        title: "Week written",
        description: wanted.length
          ? `Five lessons and a quiz. ${wanted.length === 1 ? "One day" : `${wanted.length} days`} would land better with a clip — paste a URL on ${wanted.map(w => DAY_NAMES[w.day - 1]).join(" and ")}.`
          : "Five lessons and a quiz. No day needs a video this week.",
      });
    },
    onError: (e: Error) => toast({ title: "Couldn't write the week", description: e.message, variant: "destructive" }),
  });

  const setStatus = useMutation({
    mutationFn: (status: "draft" | "locked") =>
      api(`/lean-curriculum/weeks/${weekId}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: (_r, status) => {
      refresh();
      toast({
        title: status === "locked" ? "Week locked in" : "Week back to draft",
        description: status === "locked"
          ? "It's now part of the rotation the team is taught."
          : "It won't be taught until you lock it again.",
      });
    },
    onError: (e: Error) => toast({ title: "Couldn't change the week", description: e.message, variant: "destructive" }),
  });

  const week = data?.week;
  const lessons = data?.lessons ?? [];

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            {week ? (week.partLabel ? `${week.title} — ${week.partLabel}` : week.title) : "Week"}
            {week && (
              <span className={cn(
                "text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide",
                week.status === "locked" ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600",
              )}>
                {week.status === "locked" ? "Live" : "Draft"}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary/50" /></div>
        ) : (
          <div className="space-y-5">
            {lessons.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing written yet. Add any direction you want the lessons to take, then write the week.
              </p>
            ) : (
              <div className="space-y-3">
                {lessons.map((lesson, i) => (
                  <LessonReviewCard key={lesson.id} lesson={lesson} day={DAY_NAMES[i] ?? `Day ${i + 1}`} />
                ))}
                {(data?.quiz?.length ?? 0) > 0 && (
                  <div className="border border-border rounded-xl p-3">
                    <p className="text-sm font-medium flex items-center gap-1.5 mb-2">
                      <HelpCircle className="w-4 h-4 text-primary" /> End-of-week questions
                    </p>
                    <ol className="space-y-2 list-decimal list-inside">
                      {data!.quiz.map((q, qi) => (
                        <li key={qi} className="text-xs">
                          <span className="font-medium">{q.question}</span>
                          <ul className="mt-1 ml-4 space-y-0.5">
                            {q.options.map((opt, oi) => (
                              <li key={oi} className={cn("flex items-center gap-1.5", oi === q.answer ? "text-emerald-600 font-medium" : "text-muted-foreground")}>
                                {oi === q.answer ? <Check className="w-3 h-3 flex-shrink-0" /> : <span className="w-3" />}
                                {opt}
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            )}

            {/* Writing / rewriting */}
            <div className="border-t border-border pt-4 space-y-2">
              <label className="text-xs font-medium text-muted-foreground block">
                Direction for the writer <span className="font-normal">(optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="e.g. lean on the wrapping bench for the examples; keep Friday's task to ten minutes"
                className="w-full px-2.5 py-2 bg-background border border-border rounded-lg text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                onClick={() => generate.mutate()}
                disabled={generate.isPending}
                className="w-full py-2.5 rounded-xl bg-secondary hover:bg-secondary/70 font-medium text-sm disabled:opacity-50 inline-flex items-center justify-center gap-2 transition-colors"
              >
                {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {generate.isPending ? "Writing the week…" : lessons.length ? "Rewrite this week" : "Write the five lessons"}
              </button>
              {lessons.length > 0 && (
                <p className="text-[11px] text-muted-foreground text-center">
                  Rewriting replaces all five lessons and any videos on them.
                </p>
              )}
            </div>

            {/* Locking */}
            {week && (
              <div className="border-t border-border pt-4">
                {week.status === "locked" ? (
                  <button
                    onClick={() => setStatus.mutate("draft")}
                    disabled={setStatus.isPending}
                    className="w-full py-2.5 rounded-xl bg-secondary font-medium text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Unlock className="w-4 h-4" /> Take back to draft
                  </button>
                ) : (
                  <button
                    onClick={() => setStatus.mutate("locked")}
                    disabled={setStatus.isPending || lessons.length === 0}
                    className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-medium text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {setStatus.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                    Lock this week in
                  </button>
                )}
                <p className="text-[11px] text-muted-foreground text-center mt-2">
                  {week.status === "locked"
                    ? "This week is in the rotation the team is taught."
                    : "Locking it in puts it into the rotation and onto the training matrix."}
                </p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One day of the week, as the room will see it — plus the two fields that
 *  must never reach the slide, kept visibly separate so it stays obvious
 *  which is which. Video is per-day and optional by design. */
function LessonReviewCard({ lesson, day }: { lesson: Lesson; day: string }) {
  const [showNotes, setShowNotes] = useState(false);

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="bg-secondary/40 px-3 py-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{day}</p>
          <p className="text-sm font-medium truncate">{lesson.title}</p>
        </div>
        <button
          onClick={() => setShowNotes(s => !s)}
          className="text-[11px] text-muted-foreground hover:text-foreground flex-shrink-0"
        >
          {showNotes ? "Hide host notes" : "Host notes"}
        </button>
      </div>

      <div className="p-3 space-y-3">
        <div>
          <p className="text-[11px] font-medium text-muted-foreground mb-1">On the slide</p>
          <div className="text-xs whitespace-pre-wrap leading-relaxed bg-background border border-border rounded-lg p-2.5">
            {lesson.whatToShowMd}
          </div>
        </div>

        <VideoField lesson={lesson} />

        {showNotes && (
          <div className="space-y-2 pt-1">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-1">What it means (host prep — never shown)</p>
              <div className="text-xs whitespace-pre-wrap leading-relaxed text-muted-foreground">{lesson.explanationMd}</div>
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-1">Delivery notes (never shown)</p>
              <div className="text-xs whitespace-pre-wrap leading-relaxed text-muted-foreground">{lesson.deliveryNotesMd}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Autosaving video URL for one day. A video is optional and cherry-picked —
 *  clearing the box removes it, which is how a day goes back to no clip. */
function VideoField({ lesson }: { lesson: Lesson }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(lesson.videoUrl ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const debounced = useDebouncedValue(value, 700);
  const lastSaved = useRef(lesson.videoUrl ?? "");

  useEffect(() => {
    if (debounced === lastSaved.current) return;
    let cancelled = false;
    setState("saving");
    api(`/morning-meetings/examples/${lesson.id}`, {
      method: "PUT",
      body: JSON.stringify({ videoUrl: debounced.trim() || null }),
    })
      .then(() => {
        if (cancelled) return;
        lastSaved.current = debounced;
        setState("saved");
        queryClient.invalidateQueries({ queryKey: ["lean-curriculum"] });
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setState("idle");
        toast({ title: "Couldn't save the video", description: e.message, variant: "destructive" });
      });
    return () => { cancelled = true; };
  }, [debounced, lesson.id, queryClient]);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
          <Video className="w-3 h-3" /> Video <span className="font-normal">(only if it earns its place)</span>
        </p>
        <span className="text-[10px] text-muted-foreground h-3">
          {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : ""}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="Paste a YouTube URL, or leave empty for no video"
          className="flex-1 px-2.5 py-1.5 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        {value && (
          <button
            onClick={() => setValue("")}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive transition-colors"
            aria-label="Remove the video from this day"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
