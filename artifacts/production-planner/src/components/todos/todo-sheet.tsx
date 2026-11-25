/**
 * TodoSheet — the full-screen overlay: my list (or, for managers, anyone's)
 * with a quick-add box; tapping a task pops it open over the list, already
 * editable, with its photos and comment timeline (Graeme, 2026-10-13).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ClipboardList, ListChecks, Sun, X } from "lucide-react";
import { useVisibleTeamLists } from "@/components/team-lists/team-lists-dashboard";
import { MorningReviewBanner, useSetTodoReviewEnabled, useTodoReview } from "@/components/todo-morning-review";
import { useAuth } from "@/contexts/auth-context";
import { insertOpenTodo } from "@/lib/todo-edit";
import { cn } from "@/lib/utils";
import { listKeyFor, type TodoTask } from "./api";
import { TodoCreateDialog } from "./todo-create";
import { TodoList } from "./todo-list";
import { TodoTaskDialog } from "./todo-task";

// ── The full-screen sheet ───────────────────────────────────────────────────
// The list never goes away (Graeme, 2026-10-13: "As we add items, we want to
// stay on the list. As we edit items, we also want to stay on the list").
// Adding happens in the box at the top and leaves you there, ready for the
// next one; tapping a task pops it open OVER the list, already editable;
// closing the pop-up drops you back exactly where you were in the list.

type Popup = { kind: "task"; taskId: number } | { kind: "create"; title: string } | null;

// Is a to-do sheet open anywhere (Quick actions, the 8am review, …)? The
// 8am review swaps its takeover for a banner inside the list while it is.
let todoSheetsOpen = 0;
const todoSheetListeners = new Set<() => void>();
function bumpTodoSheets(by: number) {
  todoSheetsOpen += by;
  todoSheetListeners.forEach(l => l());
}
export function useTodoSheetOpen(): boolean {
  return useSyncExternalStore(
    cb => { todoSheetListeners.add(cb); return () => { todoSheetListeners.delete(cb); }; },
    () => todoSheetsOpen > 0,
  );
}

export function TodoSheet({ open, onClose, initialTaskId }: { open: boolean; onClose: () => void; initialTaskId?: number | null }) {
  useEffect(() => {
    if (!open) return;
    bumpTodoSheets(1);
    return () => bumpTodoSheets(-1);
  }, [open]);
  const { state } = useAuth();
  const me = state.status === "authenticated" ? state.user : null;
  const canManage = me?.role === "admin" || me?.role === "manager";
  // Team lists button: only for people with a list to open (any role), or
  // admins — the same rule as the dashboard row (Graeme, 2026-10-14).
  const teamLists = useVisibleTeamLists();
  const qc = useQueryClient();

  const [popup, setPopup] = useState<Popup>(null);
  const [viewUserId, setViewUserId] = useState<number | null>(null); // null = me
  const [justAddedId, setJustAddedId] = useState<number | null>(null);
  const quickAddRef = useRef<HTMLInputElement>(null);
  // The add box's text lives here so "Add with more details" can clear it
  // once the detailed task is saved (its title came from the box).
  const [quickTitle, setQuickTitle] = useState("");

  // Every open starts on the list. A caller that names a task (a checklist
  // strip row, the founder's Schedule, the marketing calendar) gets the list
  // with that task's pop-up already open on top of it.
  useEffect(() => {
    if (open) {
      setPopup(initialTaskId ? { kind: "task", taskId: initialTaskId } : null);
      setViewUserId(null);
      setJustAddedId(null);
      setQuickTitle("");
    }
  }, [open, initialTaskId]);

  // The "just added" glow fades after a moment.
  useEffect(() => {
    if (justAddedId == null) return;
    const t = setTimeout(() => setJustAddedId(null), 2500);
    return () => clearTimeout(t);
  }, [justAddedId]);

  if (!open || !me) return null;

  const effectiveUserId = viewUserId ?? me.id;

  /** A task was just added: show it in place at once, glow it, and put the
   *  cursor back in the add box for the next one. Never opens the task. */
  const onAdded = (task: TodoTask) => {
    if (task.assignee_id === effectiveUserId) {
      const key = listKeyFor(me.id, effectiveUserId);
      qc.setQueryData<{ open: TodoTask[]; done: TodoTask[] }>(key, prev =>
        prev ? { ...prev, open: insertOpenTodo(prev.open, task) } : prev);
      setJustAddedId(task.id);
    }
    void qc.invalidateQueries({ queryKey: ["todos"] });
    requestAnimationFrame(() => quickAddRef.current?.focus({ preventScroll: true }));
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 md:px-6 py-3 border-b border-border flex-shrink-0">
        <h2 className="font-display font-bold text-2xl md:text-3xl flex items-center gap-3">
          <ClipboardList className="w-8 h-8 text-primary" />
          {viewUserId === null ? "My To-dos" : "To-do list"}
        </h2>
        <div className="flex-1" />
        {/* Team lists — the shared recurring lists (Production planner,
            Scheduling manager…) live on their own page, not on anyone's
            personal list; this is the way in from here for anyone with
            access (Graeme, 2026-10-13: "I'm on my to-dos… where do I find
            that?"). A plain link, like LinkButton: a full load closes this
            sheet. */}
        {teamLists.visible && (
          <a
            href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/lists`}
            className="h-14 px-4 rounded-2xl border-2 border-primary/40 bg-primary/10 text-primary font-bold inline-flex items-center gap-2 hover:bg-primary/15 transition-colors"
          >
            <ListChecks className="w-6 h-6" />
            <span className="hidden sm:inline">Team lists</span>
          </a>
        )}
        {viewUserId === null && <MorningReviewToggle />}
        <button
          onClick={onClose}
          aria-label="Close to-dos"
          className="w-14 h-14 rounded-2xl bg-secondary hover:bg-secondary/70 flex items-center justify-center transition-colors"
        >
          <X className="w-7 h-7" />
        </button>
      </div>

      {/* The 8am review, while it's due: what to do, and the finish button. */}
      {viewUserId === null && <MorningReviewBanner />}

      {/* Body — stays mounted under the pop-up, so its scroll position is
          exactly where it was when the pop-up closes. */}
      <div className="flex-1 overflow-y-auto">
        <div className="w-full px-4 md:px-6 py-5 pb-24">
          <TodoList
            meId={me.id}
            canManage={canManage}
            viewUserId={effectiveUserId}
            justAddedId={justAddedId}
            quickAddRef={quickAddRef}
            quickTitle={quickTitle}
            setQuickTitle={setQuickTitle}
            onSwitchUser={id => setViewUserId(id === me.id ? null : id)}
            onOpenTask={id => setPopup({ kind: "task", taskId: id })}
            onCreateWithDetails={title => setPopup({ kind: "create", title })}
            onAdded={onAdded}
          />
        </div>
      </div>

      {popup?.kind === "task" && (
        <TodoTaskDialog
          key={popup.taskId}
          taskId={popup.taskId}
          meId={me.id}
          canManage={canManage}
          onClose={() => setPopup(null)}
        />
      )}
      {popup?.kind === "create" && (
        <TodoCreateDialog
          meId={me.id}
          canManage={canManage}
          defaultAssigneeId={effectiveUserId}
          initialTitle={popup.title}
          focusAfterClose={quickAddRef}
          onClose={() => setPopup(null)}
          onAdded={task => {
            const sentTitle = popup.title;
            setPopup(null);
            setQuickTitle(cur => (cur.trim() === sentTitle ? "" : cur));
            onAdded(task);
          }}
        />
      )}
    </div>
  );
}

/** Switch the 8am review on or off (components/todo-morning-review.tsx). */
function MorningReviewToggle() {
  const review = useTodoReview();
  const set = useSetTodoReviewEnabled();
  if (!review.data) return null;
  const on = review.data.enabled;
  return (
    <button
      type="button"
      onClick={() => set.mutate(!on)}
      disabled={set.isPending}
      title={on ? "Your list pops up for review at 8am every day — tap to switch off" : "Have your list pop up for review at 8am every day"}
      className={cn(
        "h-14 px-4 rounded-2xl border-2 font-bold inline-flex items-center gap-2 transition-colors",
        on ? "border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" : "border-border text-muted-foreground hover:bg-secondary",
      )}
    >
      <Sun className="w-6 h-6" />
      <span className="hidden sm:inline">8am review: {on ? "on" : "off"}</span>
    </button>
  );
}
