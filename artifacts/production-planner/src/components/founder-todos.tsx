/**
 * The founder's own open to-dos on the Schedule page — the other half of
 * what that page is for. Same data and rules as everybody else's list, and
 * the same docked panel when one is opened (components/todos/todo-panel.tsx);
 * this is just a big, calm reading of it.
 */
import { format } from "date-fns";
import { ClipboardList, Circle, Loader2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { SubtaskProgressChip } from "@/components/subtasks/subtask-ui";
import {
  useMyTodos,
  useGuardedCompleteTodo,
  dayLabel,
  isOverdue,
  PRIORITY_META,
  type TodoTask,
} from "@/components/todo-lists";
import { useOpenMyTodos } from "@/hooks/use-team-list-dock";
import { useAuth } from "@/contexts/auth-context";
import { splitNowAndLater, sortTodos, TODO_DEFAULT_SORT, todoSortListKey } from "@/lib/task-sort";
import { TaskSortControl, useTaskSort } from "@/components/task-sort-control";

export function FounderTodos() {
  // Opens the panel beside the page — straight onto a to-do when one's named.
  const openMyTodos = useOpenMyTodos();
  const { data, isLoading } = useMyTodos();
  const completeMut = useGuardedCompleteTodo(); // asks first when sub-tasks are left
  const { state } = useAuth();
  // The same choice as on My To-dos — it's the same list.
  const [sort, setSort] = useTaskSort(todoSortListKey(state.status === "authenticated" ? state.user.id : 0), TODO_DEFAULT_SORT);

  const todayIso = format(new Date(), "yyyy-MM-dd");
  const open = sortTodos(data?.open ?? [], sort, isOverdue);
  // Same split as My to-dos (lib/task-sort.ts): no date, today or overdue
  // is now; a later do-on or due day is "not due yet".
  const { now: nowList, later: laterList } = splitNowAndLater(open, todayIso);

  return (
    <section className="rounded-3xl border border-border bg-card overflow-hidden">
      <header className="px-6 pt-6 pb-4 flex items-center gap-3">
        <ClipboardList className="w-7 h-7 text-primary flex-shrink-0" />
        <h2 className="font-display font-bold text-2xl md:text-3xl">To-dos</h2>
        {nowList.length > 0 && (
          <span className="text-lg text-muted-foreground font-medium">{nowList.length} open</span>
        )}
        {isLoading && !data && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
        <button
          type="button"
          onClick={() => openMyTodos()}
          className="ml-auto inline-flex items-center gap-1 text-base font-semibold text-primary hover:underline"
        >
          Open list <ChevronRight className="w-5 h-5" />
        </button>
      </header>

      <div className="px-4 pb-5 space-y-2">
        {open.length > 1 && <TaskSortControl spec={sort} onChange={setSort} manualLabel="Order added" className="px-2 pb-1" />}
        {nowList.map(task => (
          <TodoRow
            key={task.id}
            task={task}
            completing={completeMut.pendingId === task.id}
            disabled={completeMut.isPending}
            onComplete={() => void completeMut.complete(task)}
            onOpen={() => openMyTodos(task.id)}
          />
        ))}

        {nowList.length === 0 && (
          <p className="px-2 py-10 text-center text-xl md:text-2xl text-muted-foreground font-medium">
            {laterList.length > 0
              ? "Nothing for today — everything's scheduled ahead."
              : "Nothing on your list. Enjoy it."}
          </p>
        )}

        {laterList.length > 0 && (
          <div className="pt-3">
            <p className="px-3 pb-1.5 text-base text-muted-foreground font-medium">Scheduled ahead</p>
            {laterList.map(task => (
              <button
                key={task.id}
                type="button"
                onClick={() => openMyTodos(task.id)}
                className="w-full text-left rounded-xl px-3 py-2.5 hover:bg-secondary/30 flex items-baseline gap-3"
              >
                <span className="text-lg font-medium text-muted-foreground flex-1 min-w-0 break-words">
                  {task.title}
                </span>
                <span className="text-base text-muted-foreground flex-shrink-0">
                  {dayLabel(task.scheduled_for!)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {completeMut.prompt}
    </section>
  );
}

function TodoRow({ task, completing, disabled, onComplete, onOpen }: {
  task: TodoTask;
  completing: boolean;
  disabled: boolean;
  onComplete: () => void;
  onOpen: () => void;
}) {
  const meta = PRIORITY_META[task.priority];
  const overdue = isOverdue(task);
  const unseen = !task.acknowledged_at && task.created_by !== task.assignee_id;

  return (
    <div className="rounded-2xl flex items-stretch overflow-hidden hover:bg-secondary/30 transition-colors">
      <button
        type="button"
        onClick={onComplete}
        disabled={disabled}
        className="flex-shrink-0 w-16 flex items-center justify-center text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
        title="Mark it done"
        aria-label={`Mark "${task.title}" done`}
      >
        {completing
          ? <Loader2 className="w-8 h-8 animate-spin" />
          : <Circle className="w-9 h-9" strokeWidth={2} />}
      </button>
      <button type="button" onClick={onOpen} className="flex-1 min-w-0 text-left py-4 pr-4">
        <p className="text-xl md:text-2xl font-semibold leading-snug break-words">{task.title}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-base text-muted-foreground">
          {task.priority !== "normal" && (
            <span className={cn("font-semibold", task.priority === "low" ? "" : "text-foreground")}>
              {meta.label}
            </span>
          )}
          {task.due_date && (
            <span className={cn("font-medium", overdue && "text-red-600 dark:text-red-400 font-semibold")}>
              Due {dayLabel(task.due_date)}{overdue ? " — overdue" : ""}
            </span>
          )}
          {task.created_by_name && task.created_by !== task.assignee_id && (
            <span>from {task.created_by_name}</span>
          )}
          {unseen && <span className="font-semibold text-amber-600 dark:text-amber-400">new</span>}
          <SubtaskProgressChip subtasks={(task.subtasks ?? []).map(s => ({ id: s.id, title: s.title, notes: s.notes, url: s.url, doneAt: s.done_at }))} ticks size="sm" />
        </div>
      </button>
    </div>
  );
}
