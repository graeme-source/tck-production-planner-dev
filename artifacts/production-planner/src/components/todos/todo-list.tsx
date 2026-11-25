/**
 * The list itself: the add box, the cards, ticking, "recently done". Drawn
 * big in the full-screen sheet and `compact` in the docked panel, which can be
 * only 320px wide on a desktop-sized screen — so compact never leans on the
 * screen-width (sm:/md:) sizes, and asks its questions in the list itself
 * instead of popping anything up.
 */
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronRight, Circle, Loader2, MessageSquare, Pencil, SlidersHorizontal } from "lucide-react";
import { sourceLabel, type ParentTickChoice } from "@workspace/subtasks";
import { SmartAddBox } from "@/components/smart-add/smart-add-box";
import {
  ParentTickInline, ParentTickPrompt, SubtaskList, SubtaskProgressChip, useParentTickGuard, type SubtaskView,
} from "@/components/subtasks/subtask-ui";
import { TaskSortControl, useTaskSort } from "@/components/task-sort-control";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";
import { sortTodos, TODO_DEFAULT_SORT, todoSortListKey } from "@/lib/task-sort";
import { insertOpenTodo } from "@/lib/todo-edit";
import { cn } from "@/lib/utils";
import {
  fetchList, isOverdue, listKeyFor, post, PRIORITY_META, refreshProcessRuns, subtaskViews, useTickTodoSubtask, useTodoPeople,
  type TodoTask,
} from "./api";
import { DateChip, PriorityChip } from "./bits";

/** What happens when a to-do is added to the list on screen: it's shown in
 *  place at once, glows for a moment, and the cursor goes back to the add box
 *  for the next one. Never opens the to-do. */
export function useJustAdded(meId: number, listUserId: number) {
  const qc = useQueryClient();
  const quickAddRef = useRef<HTMLInputElement>(null);
  const [justAddedId, setJustAddedId] = useState<number | null>(null);
  useEffect(() => {
    if (justAddedId == null) return;
    const t = setTimeout(() => setJustAddedId(null), 2500);
    return () => clearTimeout(t);
  }, [justAddedId]);
  const onAdded = (task: TodoTask) => {
    if (task.assignee_id === listUserId) {
      qc.setQueryData<{ open: TodoTask[]; done: TodoTask[] }>(listKeyFor(meId, listUserId), prev =>
        prev ? { ...prev, open: insertOpenTodo(prev.open, task) } : prev);
      setJustAddedId(task.id);
    }
    void qc.invalidateQueries({ queryKey: ["todos"] });
    requestAnimationFrame(() => quickAddRef.current?.focus({ preventScroll: true }));
  };
  return { justAddedId, onAdded, quickAddRef, clearJustAdded: () => setJustAddedId(null) };
}

export function TodoList({ meId, canManage, viewUserId, justAddedId, quickAddRef, quickTitle, setQuickTitle, onSwitchUser, onOpenTask, onCreateWithDetails, onAdded, compact = false, unfinished }: {
  meId: number;
  canManage: boolean;
  viewUserId: number;
  justAddedId: number | null;
  quickAddRef: React.RefObject<HTMLInputElement | null>;
  quickTitle: string;
  setQuickTitle: (v: string) => void;
  onSwitchUser: (id: number) => void;
  onOpenTask: (id: number) => void;
  onCreateWithDetails: (title: string) => void;
  onAdded: (task: TodoTask) => void;
  /** In the docked panel. */
  compact?: boolean;
  /** Something to carry on with, under the add box. */
  unfinished?: React.ReactNode;
}) {
  const isMine = viewUserId === meId;
  const whoseId = useId();
  const listKey = listKeyFor(meId, viewUserId);
  const { data, isLoading, error } = useQuery({
    queryKey: listKey,
    queryFn: () => fetchList(isMine ? "mine" : viewUserId),
    staleTime: 15_000,
  });

  // Tick straight from the list, several in a row, without opening each one
  // (Graeme, 2026-10-08). Moves the card to "done" at once; Undo reopens.
  const qc = useQueryClient();
  const quickTick = useMutation({
    mutationFn: ({ id, done, subtasks }: { id: number; done: boolean; subtasks?: ParentTickChoice }) =>
      post(`/api/todos/${id}/${done ? "complete" : "reopen"}`, done && subtasks ? { subtasks } : undefined),
    onMutate: async ({ id, done }) => {
      await qc.cancelQueries({ queryKey: listKey });
      const prev = qc.getQueryData<{ open: TodoTask[]; done: TodoTask[] }>(listKey);
      if (prev) {
        const from = done ? prev.open : prev.done;
        const t = from.find(x => x.id === id);
        if (t) {
          const moved = { ...t, status: done ? "done" as const : "open" as const };
          qc.setQueryData(listKey, done
            ? { open: prev.open.filter(x => x.id !== id), done: [moved, ...prev.done] }
            : { open: [moved, ...prev.open], done: prev.done.filter(x => x.id !== id) });
        }
      }
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(listKey, ctx.prev);
      toast({ title: "Couldn't update the task", description: e.message, variant: "destructive" });
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: ["todos"] }); refreshProcessRuns(qc); },
  });
  // Sub-tasks still unticked: "Tick the 4 left as well?" first.
  const guard = useParentTickGuard();
  const subtaskTick = useTickTodoSubtask();
  const [askingId, setAskingId] = useState<number | null>(null);
  const tickTask = async (task: TodoTask) => {
    setAskingId(task.id);
    const choice = await guard.choose(subtaskViews(task), task.title);
    if (choice === null) return;
    quickTick.mutate({ id: task.id, done: true, subtasks: choice });
    toast({
      title: "Done ✓",
      description: task.title,
      action: <ToastAction altText="Undo" onClick={() => quickTick.mutate({ id: task.id, done: false })}>Undo</ToastAction>,
    });
  };

  const activeUsers = useTodoPeople(canManage);

  const [showDone, setShowDone] = useState(false);
  // Priority, then date unless this person picked otherwise for this list.
  const [sort, setSort] = useTaskSort(todoSortListKey(viewUserId), TODO_DEFAULT_SORT);
  const openSorted = useMemo(() => sortTodos(data?.open ?? [], sort, isOverdue), [data, sort]);

  return (
    <div className="space-y-4">
      {/* Managers can look at (and add to) anyone's list. */}
      {canManage && (
        <div className={cn("flex items-center", compact ? "gap-2" : "gap-3")}>
          <label htmlFor={whoseId} className={cn("font-semibold text-muted-foreground flex-shrink-0", compact ? "text-sm" : "text-base")}>Whose list:</label>
          <select
            id={whoseId}
            value={viewUserId}
            onChange={e => onSwitchUser(Number(e.target.value))}
            className={cn("flex-1 min-w-0 border-2 border-border bg-card font-bold focus:outline-none focus:ring-2 focus:ring-primary/40",
              compact ? "h-12 px-2 rounded-xl text-base" : "h-14 px-4 rounded-2xl text-lg")}
          >
            <option value={meId}>Me</option>
            {activeUsers.filter(u => u.id !== meId).map(u => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
      )}

      <QuickAdd
        inputRef={quickAddRef}
        title={quickTitle}
        setTitle={setQuickTitle}
        assigneeId={viewUserId}
        isMine={isMine}
        onAdded={onAdded}
        onMoreDetails={onCreateWithDetails}
        compact={compact}
      />
      {unfinished}

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-3 text-lg">
          <Loader2 className="w-6 h-6 animate-spin" /> Loading…
        </div>
      )}
      {error != null && (
        <div className="p-5 rounded-2xl bg-destructive/10 border border-destructive/20 text-destructive text-lg font-semibold">
          {(error as Error).message}
        </div>
      )}

      {data && data.open.length === 0 && (
        <div className={cn("text-center", compact ? "py-8" : "py-16")}>
          <CheckCircle2 className="w-16 h-16 mx-auto mb-4 text-primary opacity-60" />
          <p className="text-2xl font-bold">All clear!</p>
          <p className="text-lg text-muted-foreground mt-1">Nothing on {isMine ? "your" : "this"} list.</p>
        </div>
      )}

      {data && data.open.length > 1 && <TaskSortControl spec={sort} onChange={setSort} manualLabel="Order added" chip={compact} />}

      <div className={compact ? "space-y-2" : "space-y-3"}>
        {openSorted.map(task => (
          <Fragment key={task.id}>
            <TodoCard
              task={task}
              compact={compact}
              highlight={task.id === justAddedId}
              onOpen={() => onOpenTask(task.id)}
              onTick={() => void tickTask(task)}
              onTickSubtask={(s, done) => subtaskTick.mutate({ id: s.id, done })}
              subtaskBusyId={subtaskTick.isPending ? subtaskTick.variables?.id ?? null : null}
            />
            {compact && askingId === task.id && <ParentTickInline asking={guard.asking} answer={guard.answer} />}
          </Fragment>
        ))}
      </div>
      {!compact && <ParentTickPrompt asking={guard.asking} answer={guard.answer} />}

      {data && data.done.length > 0 && (
        <div className="pt-2">
          <button
            onClick={() => setShowDone(s => !s)}
            className="w-full h-12 rounded-xl text-base font-semibold text-muted-foreground hover:bg-secondary/50 transition-colors"
          >
            {showDone ? "Hide" : "Show"} recently done ({data.done.length})
          </button>
          {showDone && (
            <div className={cn("mt-3 opacity-70", compact ? "space-y-2" : "space-y-3")}>
              {data.done.map(task => <TodoCard key={task.id} task={task} compact={compact} onOpen={() => onOpenTask(task.id)} onTick={() => quickTick.mutate({ id: task.id, done: false })} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The add box. Type, press Enter (or Add), and it's on the list — the box
 * clears and keeps the cursor for the next one. "More details" opens the
 * full form in a pop-up (notes, link, priority, dates, who it's for) with
 * whatever was typed carried across. Sticky, so it stays in reach while
 * the list scrolls to show what was just added — except in the docked panel,
 * where it would take a third of the height.
 */
function QuickAdd({ inputRef, title, setTitle, assigneeId, isMine, onAdded, onMoreDetails, compact }: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  title: string;
  setTitle: (v: string) => void;
  assigneeId: number;
  isMine: boolean;
  compact: boolean;
  onAdded: (task: TodoTask) => void;
  onMoreDetails: (title: string) => void;
}) {
  // The shared smart add box (2026-10-24): "every thursday", "next monday",
  // "p1" and "@Jane Miles" read the same here as on team lists and
  // checklists, and the AI can file it on a team list or checklist instead.
  return (
    <div className={cn(!compact && "sticky top-0 z-10 -mx-4 md:-mx-6 px-4 md:px-6 py-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80")}>
      <SmartAddBox
        size={compact ? "md" : "lg"}
        stacked={compact}
        context={{ kind: "todo", assigneeId }}
        inputRef={inputRef}
        value={title}
        onValueChange={setTitle}
        placeholder={isMine ? "Add a to-do…" : "Add to this list…"}
        onAdded={a => { if (a.kind === "todo") onAdded(a.row as TodoTask); }}
      />
      <button
        type="button"
        onClick={() => { onMoreDetails(title.trim()); }}
        className={cn("mt-1 min-h-11 px-2 inline-flex items-center gap-2 font-semibold text-primary hover:underline", compact ? "text-sm" : "text-base")}
      >
        <SlidersHorizontal className="w-4 h-4" /> Add with more details{!compact && <span className="hidden sm:inline font-normal text-muted-foreground"> — notes, dates, priority</span>}
      </button>
    </div>
  );
}

function TodoCard({ task, onOpen, onTick, highlight, onTickSubtask, subtaskBusyId, compact = false }: {
  task: TodoTask; onOpen: () => void; onTick?: () => void; highlight?: boolean;
  /** Tick a sub-task straight from the list, when the card is opened up. */
  onTickSubtask?: (s: SubtaskView, done: boolean) => void;
  subtaskBusyId?: number | null;
  compact?: boolean;
}) {
  const meta = PRIORITY_META[task.priority];
  const overdue = isOverdue(task);
  const done = task.status === "done";
  const ref = useRef<HTMLDivElement>(null);
  const subs = subtaskViews(task);
  const [subsOpen, setSubsOpen] = useState(false);
  // Just added: bring it into view (under the sticky add box) so you can see
  // it landed, without moving the cursor out of the add box.
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlight]);
  return (
    <div
      ref={ref}
      data-just-added={highlight ? "true" : undefined}
      className={cn(
        "w-full rounded-2xl border-2 bg-card hover:border-primary/50 transition-all duration-500 overflow-hidden flex shadow-sm scroll-mt-36 scroll-mb-6",
        compact && "rounded-xl",
        highlight ? "border-primary ring-4 ring-primary/30 bg-primary/5" : "border-border",
      )}
    >
      <div className={cn("flex-shrink-0", compact ? "w-1.5" : "w-2.5", meta.bar)} />
      {onTick && (
        <button
          type="button"
          onClick={onTick}
          aria-label={done ? `Reopen: ${task.title}` : `Tick off: ${task.title}`}
          title={done ? "Reopen" : "Tick off"}
          className={cn("flex-shrink-0 flex items-center justify-center hover:bg-primary/5 active:bg-primary/10", compact ? "w-13" : "w-16")}
        >
          {done
            ? <CheckCircle2 className="w-9 h-9 text-primary" />
            : <Circle className="w-9 h-9 text-muted-foreground/60" />}
        </button>
      )}
      <div className="flex-1 min-w-0 flex flex-col">
      <button
        type="button"
        onClick={onOpen}
        className={cn("flex-1 min-w-0 text-left active:scale-[0.995] transition-transform", compact ? "py-3 pr-2 min-h-14" : "p-4 md:p-5 pl-1")}
      >
        <div className={cn("flex items-start", compact ? "gap-1" : "gap-3")}>
          <p className={cn(
            "flex-1 min-w-0 font-bold leading-snug break-words",
            compact ? "text-lg" : "text-xl md:text-2xl",
            task.status === "done" && "line-through text-muted-foreground",
          )}>
            {task.title}
          </p>
          {compact
            ? <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-1" aria-hidden />
            : <Pencil className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-1.5" aria-hidden />}
        </div>
        <div className={cn("flex flex-wrap items-center empty:hidden", compact ? "gap-1.5 mt-1.5" : "gap-2 mt-3")}>
          {highlight && <span className="text-sm font-bold text-primary">Just added</span>}
          {task.priority !== "normal" && <PriorityChip p={task.priority} />}
          {task.scheduled_for && <DateChip label="Do" iso={task.scheduled_for} />}
          {task.due_date && <DateChip label="Due" iso={task.due_date} overdue={overdue} />}
          {task.comment_count > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary text-sm font-semibold">
              <MessageSquare className="w-3.5 h-3.5" /> {task.comment_count}
            </span>
          )}
          {task.created_by_name && task.created_by !== task.assignee_id && (
            <span className="text-sm text-muted-foreground font-medium">from {task.created_by_name}</span>
          )}
          {task.source_team_list_item_id && (
            <span className="text-sm text-muted-foreground font-medium">{sourceLabel(task.source_list_name, task.source_item_title)}</span>
          )}
        </div>
      </button>
      {/* Sub-tasks: "3 of 7" opens them up to tick off right here. */}
      {subs.length > 0 && (
        <div className={cn("space-y-2", compact ? "pr-2 pb-3" : "px-1 pr-4 pb-4 -mt-2")}>
          <SubtaskProgressChip subtasks={subs} ticks open={subsOpen} onToggle={() => setSubsOpen(o => !o)} />
          {subsOpen && <SubtaskList subtasks={subs} onTick={!done ? onTickSubtask : undefined} busyId={subtaskBusyId} compact={compact} />}
        </div>
      )}
      </div>
    </div>
  );
}
