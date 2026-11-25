/**
 * Per-user to-do lists — big-text, big-button UI ("like CarPlay").
 *
 * Everything here is deliberately oversized: the people using it are
 * standing at a bench or walking the kitchen with an iPad, not sitting at
 * a desk. Titles are display-weight, tap targets are 56px+, and the
 * priority is a colour you can read from across the room.
 *
 * The pieces live in components/todos/ (the list, one to-do, adding one, the
 * full-screen sheet); this file is the way in for the rest of the app, plus:
 *   PersonalTodosStrip — a station checklist's "your to-dos today".
 *   TodoInterstitial   — app-wide takeover shown when someone ELSE has put
 *                        a task on my list that I haven't acknowledged.
 *                        Rendered once in Layout; polls quietly.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { CheckCircle2, ChevronRight, Circle, ClipboardList, ExternalLink, Loader2, MessageSquare, X } from "lucide-react";
import { SubtaskProgressChip } from "@/components/subtasks/subtask-ui";
import { useTaskSort } from "@/components/task-sort-control";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "@/hooks/use-toast";
import { DAILY_CHECKIN_PROMPT_KEY, usePromptKeyShowing } from "@/lib/prompt-presence";
import { sortTodos, TODO_DEFAULT_SORT, todoSortListKey } from "@/lib/task-sort";
import { taskLink, resolveTodoLink } from "@/lib/todo-link";
import { cn } from "@/lib/utils";
import {
  fetchUnacknowledged, isOverdue, post, PRIORITY_META, subtaskViews, useGuardedCompleteTodo, useMyTodos,
} from "./todos/api";
import { DateChip, PriorityChip } from "./todos/bits";
import { TodoSheet } from "./todos/todo-sheet";

export {
  dayLabel, isOverdue, PRIORITY_META, useCompleteTodo, useGuardedCompleteTodo, useMyOpenTodoCount, useMyTodos, useTickTodoSubtask,
  type TodoPriority, type TodoSubtask, type TodoTask,
} from "./todos/api";
export { TodoSheet, useTodoSheetOpen } from "./todos/todo-sheet";

// ── Personal to-dos strip for the daily checklists ─────────────────────────
// Sits at the TOP of a station's opening/cleaning/closing checklist: the
// logged-in user's own tasks, right where they already look every day —
// no hunting for them. Shows tasks actionable TODAY: anything open except
// tasks scheduled ("do it on") for a future day. Each row ticks off in
// place, checklist-style; the header opens the full sheet.

export function PersonalTodosStrip() {
  const { state } = useAuth();
  const me = state.status === "authenticated" ? state.user : null;
  // taskId set = the sheet opens straight onto that task's notes/comments.
  const [sheet, setSheet] = useState<{ open: boolean; taskId: number | null }>({ open: false, taskId: null });

  // Keyed by user id inside useMyTodos: this strip sits on the shared station
  // screens, where people swap in by PIN all day — a shared cache entry is
  // exactly how Lorna's to-dos rendered under Major's name (2026-09-04).
  const { data } = useMyTodos();
  // Same order the person chose on their My To-dos list.
  const [sort] = useTaskSort(todoSortListKey(me?.id ?? 0), TODO_DEFAULT_SORT);

  const todayIso = format(new Date(), "yyyy-MM-dd");
  const todays = sortTodos((data?.open ?? []).filter(t => !t.scheduled_for || t.scheduled_for <= todayIso), sort, isOverdue);

  // Asks "Tick the N left as well?" when a to-do still has sub-tasks open.
  const completeMut = useGuardedCompleteTodo();

  if (!me || todays.length === 0) {
    // Even with nothing due, managers/users may want the sheet from here —
    // but an empty band would be noise on a busy checklist. Render nothing.
    return null;
  }

  return (
    <div className="rounded-xl border-2 border-primary/30 bg-primary/5 overflow-hidden">
      <button
        type="button"
        onClick={() => setSheet({ open: true, taskId: null })}
        className="w-full px-5 py-3 flex items-center gap-2 text-left hover:bg-primary/10 transition-colors"
      >
        <ClipboardList className="w-6 h-6 text-primary flex-shrink-0" />
        <span className="font-display font-bold text-lg md:text-xl">Your to-dos today</span>
        <span className="text-base font-semibold text-muted-foreground">· {me.name.split(" ")[0]} only</span>
        <span className="ml-auto text-base font-bold text-primary flex items-center gap-1">
          View all <ChevronRight className="w-5 h-5" />
        </span>
      </button>
      <div className="px-3 pb-3 space-y-2">
        {todays.map(task => {
          const meta = PRIORITY_META[task.priority];
          return (
            <div key={task.id} className="rounded-xl bg-card border border-border flex items-stretch overflow-hidden">
              <div className={cn("w-2 flex-shrink-0", meta.bar)} />
              <button
                type="button"
                onClick={() => void completeMut.complete(task)}
                disabled={completeMut.isPending}
                className="flex-shrink-0 w-14 flex items-center justify-center text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                title="Mark it done"
                aria-label={`Mark "${task.title}" done`}
              >
                {completeMut.pendingId === task.id
                  ? <Loader2 className="w-7 h-7 animate-spin" />
                  : <Circle className="w-8 h-8" strokeWidth={2.5} />}
              </button>
              <button
                type="button"
                onClick={() => setSheet({ open: true, taskId: task.id })}
                className="flex-1 min-w-0 text-left py-3 pr-4 hover:bg-secondary/30 transition-colors"
              >
                <p className="text-lg md:text-xl font-bold leading-snug break-words">{task.title}</p>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  {task.priority !== "normal" && <PriorityChip p={task.priority} />}
                  {task.due_date && <DateChip label="Due" iso={task.due_date} overdue={isOverdue(task)} />}
                  {task.created_by_name && task.created_by !== task.assignee_id && (
                    <span className="text-sm text-muted-foreground font-medium">from {task.created_by_name}</span>
                  )}
                  {!task.acknowledged_at && task.created_by !== task.assignee_id && (
                    <span className="text-sm font-bold text-amber-600 dark:text-amber-400">new</span>
                  )}
                  {/* Progress only — tap the row to tick them off in the sheet. */}
                  <SubtaskProgressChip subtasks={subtaskViews(task)} ticks size="sm" />
                </div>
              </button>
            </div>
          );
        })}
      </div>
      {completeMut.prompt}
      <TodoSheet open={sheet.open} initialTaskId={sheet.taskId} onClose={() => setSheet({ open: false, taskId: null })} />
    </div>
  );
}

// ── The "you've been asked to do something" takeover ───────────────────────

export function TodoInterstitial() {
  const { state } = useAuth();
  const loggedIn = state.status === "authenticated";
  const meId = loggedIn ? state.user.id : null;
  const qc = useQueryClient();

  const { data: pending } = useQuery({
    // Keyed by user id — see the note in useMyOpenTodoCount.
    queryKey: ["todos", "unacknowledged", meId],
    queryFn: fetchUnacknowledged,
    enabled: loggedIn,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const [question, setQuestion] = useState("");
  const [askOpen, setAskOpen] = useState(false);
  const checkinShowing = usePromptKeyShowing(DAILY_CHECKIN_PROMPT_KEY);

  const task = pending?.[0] ?? null;

  // Reset the question box whenever a different task comes up.
  useEffect(() => { setQuestion(""); setAskOpen(false); }, [task?.id]);

  const ackMut = useMutation({
    mutationFn: async () => {
      if (!task) return;
      if (question.trim()) {
        await post(`/api/todos/${task.id}/comments`, { body: question.trim() });
      }
      await post(`/api/todos/${task.id}/acknowledge`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["todos"] });
    },
    onError: (e: Error) => toast({ title: "Couldn't acknowledge", description: e.message, variant: "destructive" }),
  });

  // The daily improvement check-in goes first (2026-10-21).
  if (!task || meId === null || checkinShowing) return null;

  // "Review now": acknowledge FIRST (that's what dismisses this modal on
  // every page), then follow the task's link with a full navigation.
  const reviewNow = async () => {
    if (!taskLink(task)) return;
    try {
      await ackMut.mutateAsync();
      const { href } = resolveTodoLink(taskLink(task)!);
      window.location.assign(href);
    } catch { /* the mutation's own onError toast covers it */ }
  };

  const meta = PRIORITY_META[task.priority];

  // The weekly lean lesson isn't a drop-everything task — it just has to be
  // done by its due date (Graeme, 2026-08-25: "I thought I had to start
  // doing this now"). Soften the copy and make the button say exactly what
  // acknowledging means.
  const isWeeklyLesson = !!task.lean_week_start;
  const dueLabel = task.due_date ? format(parseISO(task.due_date), "EEEE d MMM") : "the due date";

  return (
    // Viewport-fit modal (Graeme, 2026-09-14: it overflowed his phone and
    // iPad landscape with no way out): the card caps at 92dvh and scrolls
    // INTERNALLY, so the actions are always reachable, and the X in the
    // corner always offers a way out (it acknowledges — same as "I'll do
    // this later" — because an unacknowledged task would just re-open it).
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-3 md:p-8">
      <div className="bg-background rounded-3xl border border-border shadow-2xl max-w-2xl w-full max-h-[92dvh] flex flex-col overflow-hidden">
        <div className={cn("h-3 flex-shrink-0", meta.bar)} />
        <div className="p-4 md:p-8 space-y-4 md:space-y-5 overflow-y-auto">
          <div className="flex items-center justify-between gap-3">
            <p className="text-base md:text-lg font-bold text-muted-foreground uppercase tracking-wide">
              New to-do for you
              {pending && pending.length > 1 ? ` · 1 of ${pending.length}` : ""}
            </p>
            <div className="flex items-center gap-2">
              <PriorityChip p={task.priority} big />
              <button
                onClick={() => ackMut.mutate()}
                disabled={ackMut.isPending}
                aria-label="Close — keep this on my list"
                title="Close — keep this on my list"
                className="w-10 h-10 rounded-xl border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/50 flex-shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <h1 className="text-2xl md:text-4xl font-display font-bold leading-tight break-words">{task.title}</h1>

          <p className="text-lg text-muted-foreground font-medium">
            From <strong className="text-foreground">{task.created_by_name ?? "a manager"}</strong>
          </p>

          {task.notes && (
            <div className="rounded-2xl bg-secondary/40 p-5">
              <p className="text-xl leading-relaxed whitespace-pre-wrap">{task.notes}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2.5">
            {task.scheduled_for && <DateChip label="Do" iso={task.scheduled_for} big />}
            {task.due_date && <DateChip label="Due" iso={task.due_date} overdue={isOverdue(task)} big />}
          </div>

          {isWeeklyLesson && (
            <p className="text-lg text-muted-foreground">
              Nothing to do this second — just make sure it's done by <strong className="text-foreground">{dueLabel}</strong>.
            </p>
          )}

          {/* No raw link in this modal (Graeme, 2026-09-13): clicking a
              plain link navigated but the modal re-appeared on the new page
              because the task was still unacknowledged. Both primary
              actions below acknowledge FIRST, so the modal genuinely goes
              away — Review now then follows the link. */}

          {askOpen ? (
            <textarea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Type your question — it goes on the task for them to answer."
              className="w-full px-5 py-4 rounded-2xl border-2 border-border bg-card text-lg leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          ) : (
            <button
              onClick={() => setAskOpen(true)}
              className="w-full h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 transition-colors"
            >
              <MessageSquare className="w-5 h-5" /> Not sure? Ask a question first
            </button>
          )}

          {question.trim() || !task.url ? (
            <button
              onClick={() => ackMut.mutate()}
              disabled={ackMut.isPending}
              className="w-full h-16 md:h-20 rounded-2xl bg-primary text-primary-foreground text-xl md:text-2xl font-bold flex items-center justify-center gap-3 hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50 shadow-lg shadow-primary/25"
            >
              {ackMut.isPending ? <Loader2 className="w-7 h-7 animate-spin" /> : <CheckCircle2 className="w-8 h-8 flex-shrink-0" />}
              <span className={cn(isWeeklyLesson && !question.trim() && "text-xl md:text-2xl")}>
                {question.trim()
                  ? "Send question — seen it"
                  : isWeeklyLesson
                    ? `No problem — I'll get it done by ${dueLabel}`
                    : "Seen it — understood"}
              </span>
            </button>
          ) : (
            <>
              {/* Linked task: Review now goes straight there (acknowledged
                  first, so the modal is gone when the page lands); later
                  keeps the task waiting at the top of My To-dos. */}
              <button
                onClick={() => void reviewNow()}
                disabled={ackMut.isPending}
                className="w-full h-16 md:h-20 rounded-2xl bg-primary text-primary-foreground text-xl md:text-2xl font-bold flex items-center justify-center gap-3 hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50 shadow-lg shadow-primary/25"
              >
                {ackMut.isPending ? <Loader2 className="w-7 h-7 animate-spin" /> : <ExternalLink className="w-8 h-8 flex-shrink-0" />}
                Review now
              </button>
              <button
                onClick={() => ackMut.mutate()}
                disabled={ackMut.isPending}
                className="w-full h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 transition-colors disabled:opacity-50"
              >
                {isWeeklyLesson ? `I'll do it by ${dueLabel}` : "I'll do this later — keep it on my list"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
