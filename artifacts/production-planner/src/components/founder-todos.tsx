/**
 * The founder's own open to-dos on the Schedule page — the other half of
 * what that page is for. Same data, same rules and the same detail sheet as
 * everybody else's list (components/todo-lists.tsx); this is just a big,
 * calm reading of it.
 */
import { useState } from "react";
import { format } from "date-fns";
import { ClipboardList, Circle, Loader2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TodoSheet,
  useMyTodos,
  useCompleteTodo,
  dayLabel,
  isOverdue,
  PRIORITY_META,
  type TodoTask,
} from "@/components/todo-lists";

export function FounderTodos() {
  // taskId set = the sheet opens straight onto that task's notes/comments.
  const [sheet, setSheet] = useState<{ open: boolean; taskId: number | null }>({ open: false, taskId: null });
  const { data, isLoading } = useMyTodos();
  const completeMut = useCompleteTodo();

  const todayIso = format(new Date(), "yyyy-MM-dd");
  const open = data?.open ?? [];
  // Anything not deliberately pushed to a future day is on today's plate.
  const nowList = open.filter(t => !t.scheduled_for || t.scheduled_for <= todayIso);
  const laterList = open.filter(t => t.scheduled_for && t.scheduled_for > todayIso);

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
          onClick={() => setSheet({ open: true, taskId: null })}
          className="ml-auto inline-flex items-center gap-1 text-base font-semibold text-primary hover:underline"
        >
          Open list <ChevronRight className="w-5 h-5" />
        </button>
      </header>

      <div className="px-4 pb-5 space-y-2">
        {nowList.map(task => (
          <TodoRow
            key={task.id}
            task={task}
            completing={completeMut.isPending && completeMut.variables === task.id}
            disabled={completeMut.isPending}
            onComplete={() => completeMut.mutate(task.id)}
            onOpen={() => setSheet({ open: true, taskId: task.id })}
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
                onClick={() => setSheet({ open: true, taskId: task.id })}
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

      <TodoSheet
        open={sheet.open}
        initialTaskId={sheet.taskId}
        onClose={() => setSheet({ open: false, taskId: null })}
      />
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
        </div>
      </button>
    </div>
  );
}
