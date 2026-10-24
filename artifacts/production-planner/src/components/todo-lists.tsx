/**
 * Per-user to-do lists — big-text, big-button UI ("like CarPlay").
 *
 * Everything here is deliberately oversized: the people using it are
 * standing at a bench or walking the kitchen with an iPad, not sitting at
 * a desk. Titles are display-weight, tap targets are 56px+, and the
 * priority is a colour you can read from across the room.
 *
 * Three exports:
 *   TodoSheet        — full-screen overlay: my list (or, for managers,
 *                      anyone's) with a quick-add box; tapping a task pops
 *                      it open over the list, already editable, with its
 *                      photos and comment timeline (Graeme, 2026-10-13).
 *   TodoInterstitial — app-wide takeover shown when someone ELSE has put
 *                      a task on my list that I haven't acknowledged.
 *                      Rendered once in Layout; polls quietly.
 *   useMyOpenTodoCount — badge feed for buttons that open the sheet.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isBefore, isToday, parseISO } from "date-fns";
import { useAuth } from "@/contexts/auth-context";
import { DAILY_CHECKIN_PROMPT_KEY, usePromptKeyShowing } from "@/lib/prompt-presence";
import { useVisibleTeamLists } from "@/components/team-lists/team-lists-dashboard";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { resolveTodoLink } from "@/lib/todo-link";
import {
  EMPTY_TODO_FORM, insertOpenTodo, todoCreateBody, todoEditPatch, todoFormFrom, todoFormValid,
  type TodoEditable, type TodoForm, type TodoPatch,
} from "@/lib/todo-edit";
import { sortTodos, TODO_DEFAULT_SORT, todoSortListKey } from "@/lib/task-sort";
import { TaskSortControl, useTaskSort } from "@/components/task-sort-control";
import { EditorDialog } from "@/components/recipe-editor/editor-dialog";
import { PinnedFooter } from "@/components/ui/pinned-save-bar";
import { useNoScrollAutoFocus } from "@/hooks/use-modal-scroll";
import {
  CalendarDays, Camera, Check, CheckCircle2, ChevronRight, Circle, ClipboardList,
  ExternalLink, Flag, Lightbulb, ListChecks, Loader2, MessageSquare, Pencil, Plus, RotateCcw,
  Send, SlidersHorizontal, Sun, Trash2, X,
} from "lucide-react";

import { SmartAddBox } from "@/components/smart-add/smart-add-box";
import { MorningReviewBanner, useSetTodoReviewEnabled, useTodoReview } from "@/components/todo-morning-review";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types (server sends snake_case rows) ────────────────────────────────────

export type TodoPriority = "urgent" | "high" | "normal" | "low";

export interface TodoTask {
  id: number;
  assignee_id: number;
  assignee_name: string | null;
  created_by: number | null;
  created_by_name: string | null;
  title: string;
  notes: string | null;
  url: string | null;
  priority: TodoPriority;
  scheduled_for: string | null;
  due_date: string | null;
  status: "open" | "done";
  acknowledged_at: string | null;
  completed_at: string | null;
  created_at: string;
  comment_count: number;
  attachment_count: number;
  improvement_id: number | null;
  /** Set on the auto-created weekly lean lesson task — the interstitial
   *  softens into "get it done by Friday" rather than "do this now". */
  lean_week_start: string | null;
}

interface TodoAttachment {
  id: number;
  kind: "image" | "video";
  mime: string;
  file_name: string | null;
  uploaded_by: number | null;
  uploaded_by_name: string | null;
  created_at: string;
}

interface TodoComment {
  id: number;
  user_id: number | null;
  user_name: string | null;
  kind: "comment" | "event";
  body: string;
  created_at: string;
}

interface AppUserRow { id: number; name: string; role: string; isActive: boolean }

export const PRIORITY_META: Record<TodoPriority, { label: string; bar: string; chip: string; solid: string }> = {
  urgent: {
    label: "Urgent",
    bar: "bg-red-500",
    chip: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    solid: "bg-red-500 text-white border-red-500",
  },
  high: {
    label: "High",
    bar: "bg-amber-500",
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    solid: "bg-amber-500 text-white border-amber-500",
  },
  normal: {
    label: "Normal",
    bar: "bg-primary",
    chip: "bg-primary/15 text-primary",
    solid: "bg-primary text-primary-foreground border-primary",
  },
  low: {
    label: "Low",
    bar: "bg-slate-400",
    chip: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    solid: "bg-slate-500 text-white border-slate-500",
  },
};

// ── Fetch helpers ───────────────────────────────────────────────────────────

async function jsonOrThrow(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Request failed");
  return data;
}

async function fetchList(userId: number | "mine"): Promise<{ open: TodoTask[]; done: TodoTask[] }> {
  const path = userId === "mine" ? "/api/todos/mine" : `/api/todos/user/${userId}`;
  return jsonOrThrow(await fetch(`${BASE}${path}`, { credentials: "include" }));
}

async function fetchTask(id: number): Promise<TodoTask & { comments: TodoComment[]; attachments: TodoAttachment[] }> {
  return jsonOrThrow(await fetch(`${BASE}/api/todos/${id}`, { credentials: "include" }));
}

async function fetchUnacknowledged(): Promise<TodoTask[]> {
  return jsonOrThrow(await fetch(`${BASE}/api/todos/unacknowledged`, { credentials: "include" }));
}

function post(path: string, body?: unknown) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).then(jsonOrThrow);
}

// Timestamps arrive as "2026-08-20 11:14:57.203857" (no T, no zone) — treat
// as UTC-naive local; only used for display so close enough is fine.
function parseTs(s: string): Date {
  return new Date(s.replace(" ", "T"));
}

export function dayLabel(iso: string): string {
  const d = parseISO(iso);
  if (isToday(d)) return "Today";
  return format(d, "EEE d MMM");
}

export function isOverdue(task: TodoTask): boolean {
  if (task.status !== "open" || !task.due_date) return false;
  const d = parseISO(task.due_date);
  return isBefore(d, new Date()) && !isToday(d);
}

/**
 * The signed-in user's own list. ONE definition of the query so every
 * surface that shows "my to-dos" (the station strip, the badge count, the
 * founder's Schedule page) shares a single cache entry and refresh rhythm.
 */
export function useMyTodos() {
  const { state } = useAuth();
  const meId = state.status === "authenticated" ? state.user.id : null;
  return useQuery({
    // Keyed by user id (like every "mine" query here): the station PCs are
    // shared, and a cache entry keyed the same for everyone briefly shows the
    // previous person's data after a PIN switch — see lib/session-identity.ts.
    queryKey: ["todos", "mine", meId],
    queryFn: () => fetchList("mine"),
    enabled: meId !== null,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

/** Tick a to-do off, with the same visible failure everywhere it's offered. */
export function useCompleteTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => post(`/api/todos/${id}/complete`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["todos"] }),
    onError: (e: Error) => toast({ title: "Couldn't mark it done", description: e.message, variant: "destructive" }),
  });
}

/** Open-task count for the current user — feeds button badges. */
export function useMyOpenTodoCount(): number {
  return useMyTodos().data?.open.length ?? 0;
}

// ── Shared big-chip bits ────────────────────────────────────────────────────

function PriorityChip({ p, big }: { p: TodoPriority; big?: boolean }) {
  const meta = PRIORITY_META[p];
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full font-bold",
      big ? "px-4 py-1.5 text-base" : "px-3 py-1 text-sm",
      meta.chip,
    )}>
      <Flag className={big ? "w-4 h-4" : "w-3.5 h-3.5"} />
      {meta.label}
    </span>
  );
}

function DateChip({ label, iso, overdue, big }: { label: string; iso: string; overdue?: boolean; big?: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full font-semibold",
      big ? "px-4 py-1.5 text-base" : "px-3 py-1 text-sm",
      overdue
        ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
        : "bg-secondary text-foreground",
    )}>
      <CalendarDays className={big ? "w-4 h-4" : "w-3.5 h-3.5"} />
      {label} {dayLabel(iso)}{overdue ? " — overdue" : ""}
    </span>
  );
}

function LinkButton({ url, big }: { url: string; big?: boolean }) {
  const { href, label, external } = resolveTodoLink(url);
  // App-relative links deliberately use a plain same-tab anchor rather than
  // SPA navigation: the sheet lives in Layout, so a wouter navigate would
  // leave it open on top of the destination page. A full load closes it.
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      onClick={e => e.stopPropagation()}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl border-2 border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-bold hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors",
        big ? "px-5 py-3.5 text-lg" : "px-4 py-2 text-base",
      )}
    >
      <ExternalLink className={big ? "w-5 h-5" : "w-4 h-4"} />
      Open link — {label}
    </a>
  );
}

// ── The full-screen sheet ───────────────────────────────────────────────────
// The list never goes away (Graeme, 2026-10-13: "As we add items, we want to
// stay on the list. As we edit items, we also want to stay on the list").
// Adding happens in the box at the top and leaves you there, ready for the
// next one; tapping a task pops it open OVER the list, already editable;
// closing the pop-up drops you back exactly where you were in the list.

type Popup = { kind: "task"; taskId: number } | { kind: "create"; title: string } | null;

function listKeyFor(meId: number, userId: number) {
  // Both branches carry the user id — see the note in useMyTodos.
  return userId === meId ? ["todos", "mine", meId] : ["todos", "user", userId];
}

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

// ── List view ───────────────────────────────────────────────────────────────

function TodoList({ meId, canManage, viewUserId, justAddedId, quickAddRef, quickTitle, setQuickTitle, onSwitchUser, onOpenTask, onCreateWithDetails, onAdded }: {
  meId: number;
  canManage: boolean;
  viewUserId: number;
  justAddedId: number | null;
  quickAddRef: React.RefObject<HTMLInputElement | null>;
  quickTitle: string;
  setQuickTitle: React.Dispatch<React.SetStateAction<string>>;
  onSwitchUser: (id: number) => void;
  onOpenTask: (id: number) => void;
  onCreateWithDetails: (title: string) => void;
  onAdded: (task: TodoTask) => void;
}) {
  const isMine = viewUserId === meId;
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
    mutationFn: ({ id, done }: { id: number; done: boolean }) => post(`/api/todos/${id}/${done ? "complete" : "reopen"}`),
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
    onSettled: () => qc.invalidateQueries({ queryKey: ["todos"] }),
  });
  const tickTask = (task: TodoTask) => {
    quickTick.mutate({ id: task.id, done: true });
    toast({
      title: "Done ✓",
      description: task.title,
      action: <ToastAction altText="Undo" onClick={() => quickTick.mutate({ id: task.id, done: false })}>Undo</ToastAction>,
    });
  };

  const { data: users } = useQuery({
    queryKey: ["todo-users"],
    queryFn: async (): Promise<AppUserRow[]> => jsonOrThrow(await fetch(`${BASE}/api/users`, { credentials: "include" })),
    staleTime: 5 * 60_000,
    enabled: canManage,
  });
  const activeUsers = (users ?? []).filter(u => u.isActive);

  const [showDone, setShowDone] = useState(false);
  // Priority, then date unless this person picked otherwise for this list.
  const [sort, setSort] = useTaskSort(todoSortListKey(viewUserId), TODO_DEFAULT_SORT);
  const openSorted = useMemo(() => sortTodos(data?.open ?? [], sort, isOverdue), [data, sort]);

  return (
    <div className="space-y-4">
      {/* Managers can look at (and add to) anyone's list. */}
      {canManage && (
        <div className="flex items-center gap-3">
          <label className="text-base font-semibold text-muted-foreground flex-shrink-0">Whose list:</label>
          <select
            value={viewUserId}
            onChange={e => onSwitchUser(Number(e.target.value))}
            className="flex-1 h-14 px-4 rounded-2xl border-2 border-border bg-card text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/40"
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
      />

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
        <div className="text-center py-16">
          <CheckCircle2 className="w-16 h-16 mx-auto mb-4 text-primary opacity-60" />
          <p className="text-2xl font-bold">All clear!</p>
          <p className="text-lg text-muted-foreground mt-1">Nothing on {isMine ? "your" : "this"} list.</p>
        </div>
      )}

      {data && data.open.length > 1 && <TaskSortControl spec={sort} onChange={setSort} manualLabel="Order added" />}

      <div className="space-y-3">
        {openSorted.map(task => (
          <TodoCard
            key={task.id}
            task={task}
            highlight={task.id === justAddedId}
            onOpen={() => onOpenTask(task.id)}
            onTick={() => tickTask(task)}
          />
        ))}
      </div>

      {data && data.done.length > 0 && (
        <div className="pt-2">
          <button
            onClick={() => setShowDone(s => !s)}
            className="w-full h-12 rounded-xl text-base font-semibold text-muted-foreground hover:bg-secondary/50 transition-colors"
          >
            {showDone ? "Hide" : "Show"} recently done ({data.done.length})
          </button>
          {showDone && (
            <div className="space-y-3 mt-3 opacity-70">
              {data.done.map(task => <TodoCard key={task.id} task={task} onOpen={() => onOpenTask(task.id)} onTick={() => quickTick.mutate({ id: task.id, done: false })} />)}
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
 * the list scrolls to show what was just added.
 */
function QuickAdd({ inputRef, title, setTitle, assigneeId, isMine, onAdded, onMoreDetails }: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  title: string;
  setTitle: React.Dispatch<React.SetStateAction<string>>;
  assigneeId: number;
  isMine: boolean;
  onAdded: (task: TodoTask) => void;
  onMoreDetails: (title: string) => void;
}) {
  // The shared smart add box (2026-10-24): "every thursday", "next monday",
  // "p1" and "@Jane Miles" read the same here as on team lists and
  // checklists, and the AI can file it on a team list or checklist instead.
  return (
    <div className="sticky top-0 z-10 -mx-4 md:-mx-6 px-4 md:px-6 py-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <SmartAddBox
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
        className="mt-1 min-h-11 px-2 inline-flex items-center gap-2 text-base font-semibold text-primary hover:underline"
      >
        <SlidersHorizontal className="w-4 h-4" /> Add with more details<span className="hidden sm:inline font-normal text-muted-foreground"> — notes, dates, priority</span>
      </button>
    </div>
  );
}

function TodoCard({ task, onOpen, onTick, highlight }: { task: TodoTask; onOpen: () => void; onTick?: () => void; highlight?: boolean }) {
  const meta = PRIORITY_META[task.priority];
  const overdue = isOverdue(task);
  const done = task.status === "done";
  const ref = useRef<HTMLDivElement>(null);
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
        highlight ? "border-primary ring-4 ring-primary/30 bg-primary/5" : "border-border",
      )}
    >
      <div className={cn("w-2.5 flex-shrink-0", meta.bar)} />
      {onTick && (
        <button
          type="button"
          onClick={onTick}
          aria-label={done ? `Reopen: ${task.title}` : `Tick off: ${task.title}`}
          title={done ? "Reopen" : "Tick off"}
          className="flex-shrink-0 w-16 flex items-center justify-center hover:bg-primary/5 active:bg-primary/10"
        >
          {done
            ? <CheckCircle2 className="w-9 h-9 text-primary" />
            : <Circle className="w-9 h-9 text-muted-foreground/60" />}
        </button>
      )}
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 min-w-0 text-left p-4 md:p-5 pl-1 active:scale-[0.995] transition-transform"
      >
        <div className="flex items-start gap-3">
          <p className={cn(
            "flex-1 text-xl md:text-2xl font-bold leading-snug break-words",
            task.status === "done" && "line-through text-muted-foreground",
          )}>
            {task.title}
          </p>
          <Pencil className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-1.5" aria-hidden />
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
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
        </div>
      </button>
    </div>
  );
}

// ── The task pop-up: view + edit in one ─────────────────────────────────────
// Opens over the list ALREADY editable (Graeme, 2026-10-13: "I actually just
// want to be able to edit it from the main to-do list, and then save, and
// then it goes back to the to-do list"). Saving is explicit — the pinned
// green "Save changes" — not autosave, matching how to-dos always saved:
// every save writes "… edited the task" on the timeline, and autosave would
// write one per pause in typing. Closing with unsaved changes asks
// Save / Discard / Keep editing (the shared EditorDialog guard).
//
// "Mark as done" is deliberately NOT the primary: it was the big green
// button on the old detail page, and people pressed it thinking it saved.
// It's an outlined button on the left of the footer; the list row's tick
// circle is still the quick way.

function TodoTaskDialog({ taskId, meId, canManage, onClose }: {
  taskId: number;
  meId: number;
  canManage: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: task, isLoading, error } = useQuery({
    queryKey: ["todo", taskId],
    queryFn: () => fetchTask(taskId),
    staleTime: 5_000,
  });

  // The form starts from the task as first loaded. Comparing against that
  // (not the latest refetch) means a save only sends what THIS person
  // changed, never undoing someone else's edit made meanwhile.
  const [baseline, setBaseline] = useState<TodoForm | null>(null);
  const [form, setForm] = useState<TodoForm | null>(null);
  useEffect(() => {
    if (task && baseline === null) {
      const f = todoFormFrom(task);
      setBaseline(f);
      setForm(f);
    }
  }, [task, baseline]);

  const baselineTask = baseline && {
    title: baseline.title, notes: baseline.notes, url: baseline.url, priority: baseline.priority,
    scheduled_for: baseline.scheduledFor || null, due_date: baseline.dueDate || null,
  };
  const patch = baselineTask && form ? todoEditPatch(baselineTask, form) : null;
  const dirty = patch !== null;
  const valid = form ? todoFormValid(form) : false;

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [comment, setComment] = useState("");
  const commentsEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Separate camera input for the "done + improvement" path: it opens the
  // camera straight away and, once the shot lands, finishes the job.
  const improvementCameraRef = useRef<HTMLInputElement>(null);
  const [pendingImprovement, setPendingImprovement] = useState(false);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["todo", taskId] });
    qc.invalidateQueries({ queryKey: ["todos"] });
  }

  const saveMut = useMutation({
    mutationFn: (p: TodoPatch): Promise<TodoTask> => fetch(`${BASE}/api/todos/${taskId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    }).then(jsonOrThrow),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast({ title: "Couldn't save the task", description: `${e.message} — your changes are still here.`, variant: "destructive" }),
  });
  const completeMut = useMutation({
    mutationFn: (done: boolean) => post(`/api/todos/${taskId}/${done ? "complete" : "reopen"}`),
    onSuccess: invalidate,
    onError: (e: Error) => toast({ title: "Couldn't update the task", description: e.message, variant: "destructive" }),
  });
  const deleteMut = useMutation({
    mutationFn: () => fetch(`${BASE}/api/todos/${taskId}`, { method: "DELETE", credentials: "include" }).then(jsonOrThrow),
    onSuccess: () => { invalidate(); onClose(); toast({ title: "Task deleted" }); },
    onError: (e: Error) => toast({ title: "Couldn't delete the task", description: e.message, variant: "destructive" }),
  });
  const commentMut = useMutation({
    mutationFn: (body: string) => post(`/api/todos/${taskId}/comments`, { body }),
    onSuccess: () => {
      setComment("");
      invalidate();
      setTimeout(() => commentsEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 150);
    },
    onError: (e: Error) => toast({ title: "Comment didn't send", description: e.message, variant: "destructive" }),
  });
  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${BASE}/api/todos/${taskId}/attachments`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      return jsonOrThrow(res);
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });
  const deleteAttMut = useMutation({
    mutationFn: (attId: number) => fetch(`${BASE}/api/todos/attachments/${attId}`, { method: "DELETE", credentials: "include" }).then(jsonOrThrow),
    onSuccess: invalidate,
    onError: (e: Error) => toast({ title: "Couldn't delete it", description: e.message, variant: "destructive" }),
  });
  const tagImprovementMut = useMutation({
    mutationFn: () => post(`/api/todos/${taskId}/tag-improvement`) as Promise<{ awaitingApproval?: boolean }>,
    onSuccess: (res) => {
      invalidate();
      toast({
        title: "Logged as an improvement",
        description: res?.awaitingApproval
          ? "Photos and all — a manager will sign it off."
          : "Add a photo to it and it'll be ready for sign-off.",
      });
    },
    onError: (e: Error) => toast({ title: "Couldn't log it", description: e.message, variant: "destructive" }),
  });

  /** Save what changed (if anything), then back to the list. */
  async function saveAndClose() {
    if (patch) {
      if (!valid) { toast({ title: "It needs a title", description: "Type what needs doing, then save.", variant: "destructive" }); return; }
      try { await saveMut.mutateAsync(patch); } catch { return; }
      toast({ title: "Task updated" });
    }
    onClose();
  }

  /** Mark as done from the pop-up: keep any edits, tick it, back to the list. */
  async function markDone() {
    if (!task) return;
    try {
      if (patch && valid) await saveMut.mutateAsync(patch);
      await completeMut.mutateAsync(true);
    } catch { return; }
    onClose();
    toast({
      title: "Done ✓",
      description: form?.title.trim() || task.title,
      action: (
        <ToastAction altText="Undo" onClick={() => { void post(`/api/todos/${taskId}/reopen`).then(invalidate); }}>
          Undo
        </ToastAction>
      ),
    });
  }

  /**
   * "Mark it done, and it's an improvement" — the moment someone finishes a
   * job is the one moment they're standing in front of the evidence, so this
   * is where we ask for the photo rather than hoping they go and file one
   * later. With media already on the task it just completes and files it;
   * without, it opens the camera first and files it once the shot is in.
   */
  const completeAsImprovement = async () => {
    if ((task?.attachments?.length ?? 0) === 0) {
      setPendingImprovement(true);
      improvementCameraRef.current?.click();
      return;
    }
    await completeMut.mutateAsync(true);
    await tagImprovementMut.mutateAsync();
  };

  const canEdit = !!task && (canManage || task.assignee_id === meId);
  const canDelete = !!task && (canManage || task.created_by === meId);
  const isDone = task?.status === "done";
  const busy = saveMut.isPending || completeMut.isPending || pendingImprovement;

  return (
    <EditorDialog
      open
      onClose={onClose}
      title={<><ClipboardList className="w-6 h-6 text-primary" /> {canEdit ? "Edit to-do" : "To-do"}</>}
      dirty={dirty}
      onSaveRequest={() => void saveAndClose()}
      entityLabel="to-do"
      widthClassName="sm:max-w-3xl"
      noAutoFocus
    >
      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-3 text-lg"><Loader2 className="w-6 h-6 animate-spin" /> Loading…</div>
      )}
      {!isLoading && (error != null || !task) && (
        <div className="my-5 p-5 rounded-2xl bg-destructive/10 text-destructive text-lg font-semibold">This task is gone — it may have been deleted.</div>
      )}

      {task && form && (
        <div className="space-y-5 pt-4" data-testid="todo-popup">
          <p className="text-base text-muted-foreground font-medium">
            For <strong className="text-foreground">{task.assignee_name}</strong>
            {task.created_by_name ? <> · added by <strong className="text-foreground">{task.created_by_name}</strong></> : null}
            {task.acknowledged_at ? <> · <span className="text-primary font-semibold">seen ✓</span></> : null}
            {isDone ? <> · <span className="text-primary font-semibold">done ✓</span></> : null}
          </p>

          {canEdit ? (
            <TodoFields form={form} onChange={setForm} onEnter={() => void saveAndClose()} />
          ) : (
            <div className="rounded-2xl border-2 border-border bg-card overflow-hidden flex shadow-sm">
              <div className={cn("w-3 flex-shrink-0", PRIORITY_META[task.priority].bar)} />
              <div className="p-5 flex-1 min-w-0 space-y-3">
                <h3 className={cn("text-2xl md:text-3xl font-display font-bold leading-tight break-words", isDone && "line-through text-muted-foreground")}>{task.title}</h3>
                <div className="flex flex-wrap items-center gap-2.5">
                  <PriorityChip p={task.priority} big />
                  {task.scheduled_for && <DateChip label="Do" iso={task.scheduled_for} big />}
                  {task.due_date && <DateChip label="Due" iso={task.due_date} overdue={isOverdue(task)} big />}
                </div>
                {task.notes && <p className="text-xl leading-relaxed whitespace-pre-wrap">{task.notes}</p>}
              </div>
            </div>
          )}

          {task.url && <LinkButton url={task.url} big />}

          {/* Photos & videos — evidence of the job or the problem. */}
          <div className="space-y-3">
            {task.attachments.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {task.attachments.map(att => (
                  <div key={att.id} className="relative rounded-2xl overflow-hidden border-2 border-border bg-black/5 group">
                    {att.kind === "image" ? (
                      <a href={`${BASE}/api/todos/attachments/${att.id}`} target="_blank" rel="noopener noreferrer">
                        <img
                          src={`${BASE}/api/todos/attachments/${att.id}`}
                          alt={att.file_name ?? "Task photo"}
                          className="w-full h-40 object-cover"
                          loading="lazy"
                        />
                      </a>
                    ) : (
                      <video
                        src={`${BASE}/api/todos/attachments/${att.id}`}
                        controls
                        preload="metadata"
                        className="w-full h-40 object-cover bg-black"
                      />
                    )}
                    {(canManage || att.uploaded_by === meId) && (
                      <button
                        type="button"
                        onClick={() => deleteAttMut.mutate(att.id)}
                        disabled={deleteAttMut.isPending}
                        className="absolute top-2 right-2 w-9 h-9 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-destructive transition-colors"
                        aria-label="Delete this photo or video"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    {att.uploaded_by_name && (
                      <span className="absolute bottom-0 inset-x-0 px-2 py-1 text-[11px] font-semibold text-white bg-gradient-to-t from-black/70 to-transparent truncate">
                        {att.uploaded_by_name}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) uploadMut.mutate(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMut.isPending}
              className="w-full h-14 rounded-2xl border-2 border-dashed border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 transition-colors disabled:opacity-50"
            >
              {uploadMut.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
              {uploadMut.isPending ? "Uploading…" : "Add a photo or video"}
            </button>
          </div>

          {/* Camera for the "done + improvement" path. Completing the job is
              chained onto the upload so the photo and the sign-off are one
              action from the person's point of view. */}
          <input
            ref={improvementCameraRef}
            type="file"
            accept="image/*,video/*"
            capture="environment"
            className="hidden"
            onChange={async e => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) { setPendingImprovement(false); return; }
              try {
                await uploadMut.mutateAsync(file);
                await completeMut.mutateAsync(true);
                await tagImprovementMut.mutateAsync();
              } finally {
                setPendingImprovement(false);
              }
            }}
          />

          {task.improvement_id && (
            <div className="flex items-center gap-2 text-base font-bold text-primary bg-primary/10 rounded-2xl px-5 py-3.5">
              <Lightbulb className="w-5 h-5 flex-shrink-0" />
              In the improvement library ✓
            </div>
          )}

          {/* Improvement + delete. Finishing a job is the moment someone is
              standing in front of what they changed, so the improvement
              option lives here rather than as a step they'd have to remember. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {!isDone && !task.improvement_id && canEdit && (
              <button
                type="button"
                onClick={() => void completeAsImprovement()}
                disabled={busy || tagImprovementMut.isPending}
                className="h-16 rounded-2xl border-2 border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 text-lg font-bold flex flex-col items-center justify-center gap-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors disabled:opacity-50 active:scale-[0.99]"
              >
                <span className="flex items-center gap-2">
                  {pendingImprovement || tagImprovementMut.isPending
                    ? <Loader2 className="w-5 h-5 animate-spin" />
                    : <Lightbulb className="w-5 h-5" />}
                  Done — and it's an improvement
                </span>
                <span className="text-sm font-semibold opacity-80">
                  {(task.attachments?.length ?? 0) === 0 ? "Takes a photo first" : "Sends it for sign-off"}
                </span>
              </button>
            )}
            {isDone && !task.improvement_id && canEdit && (
              <button
                type="button"
                onClick={() => tagImprovementMut.mutate()}
                disabled={tagImprovementMut.isPending}
                className="h-14 rounded-2xl border-2 border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 text-lg font-bold flex items-center justify-center gap-2 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors disabled:opacity-50"
              >
                {tagImprovementMut.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lightbulb className="w-5 h-5" />}
                This was an improvement
              </button>
            )}
            {canDelete && (
              confirmDelete ? (
                <button
                  type="button"
                  onClick={() => deleteMut.mutate()}
                  disabled={deleteMut.isPending}
                  className="h-14 rounded-2xl bg-destructive text-destructive-foreground text-lg font-bold flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50"
                >
                  {deleteMut.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
                  Really delete?
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="h-14 rounded-2xl border-2 border-destructive/40 text-destructive text-lg font-bold flex items-center justify-center gap-2 hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 className="w-5 h-5" /> Delete
                </button>
              )
            )}
          </div>

          {/* Timeline */}
          <div className="pt-2">
            <h3 className="text-lg font-bold text-muted-foreground mb-3">What's happened</h3>
            <div className="space-y-3">
              {task.comments.map(c =>
                c.kind === "event" ? (
                  <p key={c.id} className="text-center text-base text-muted-foreground font-medium">
                    {c.body} · {format(parseTs(c.created_at), "EEE d MMM, HH:mm")}
                  </p>
                ) : (
                  <div key={c.id} className={cn(
                    "rounded-2xl p-4 max-w-[85%]",
                    c.user_id === meId ? "bg-primary/10 ml-auto" : "bg-secondary/60",
                  )}>
                    <p className="text-sm font-bold text-muted-foreground mb-1">
                      {c.user_name ?? "Someone"} · {format(parseTs(c.created_at), "EEE d MMM, HH:mm")}
                    </p>
                    <p className="text-lg leading-relaxed whitespace-pre-wrap">{c.body}</p>
                  </div>
                ),
              )}
              <div ref={commentsEndRef} />
            </div>

            <form
              className="flex gap-2 mt-4"
              onSubmit={e => { e.preventDefault(); if (comment.trim()) commentMut.mutate(comment.trim()); }}
            >
              <input
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="Ask a question or leave an update…"
                className="flex-1 min-w-0 h-14 px-4 rounded-2xl border-2 border-border bg-card text-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <button
                type="submit"
                disabled={!comment.trim() || commentMut.isPending}
                className="w-14 h-14 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-all flex-shrink-0"
                aria-label="Send comment"
              >
                {commentMut.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : <Send className="w-6 h-6" />}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Pinned footer: Mark as done (outlined, left) · Save changes / Close (right). */}
      <PinnedFooter fallback="sticky">
        <div className="flex flex-col gap-2" data-testid="todo-popup-footer" data-dirty={dirty ? "true" : "false"}>
          {dirty && (
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5" role="status">
              <span className="w-2 h-2 rounded-full bg-amber-500" aria-hidden /> Unsaved changes
            </p>
          )}
          <div className="flex gap-3">
            {task && (
              isDone ? (
                <button
                  type="button"
                  onClick={() => completeMut.mutate(false)}
                  disabled={busy}
                  className="min-h-14 px-4 rounded-2xl border-2 border-border bg-card text-base sm:text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 transition-colors disabled:opacity-50"
                >
                  {completeMut.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <RotateCcw className="w-5 h-5" />}
                  Put it back on the list
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void markDone()}
                  disabled={busy}
                  className="min-h-14 px-4 rounded-2xl border-2 border-border bg-card text-base sm:text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 transition-colors disabled:opacity-50"
                >
                  {completeMut.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                  Mark as done
                </button>
              )
            )}
            <button
              type="button"
              onClick={() => void saveAndClose()}
              disabled={saveMut.isPending}
              className={cn(
                "flex-1 min-h-14 rounded-2xl text-lg font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-60",
                dirty ? "bg-[#7cb342] text-white hover:bg-[#6a9c37]" : "bg-secondary text-foreground hover:bg-secondary/70",
              )}
            >
              {saveMut.isPending && <Loader2 className="w-5 h-5 animate-spin" />}
              {saveMut.isPending ? "Saving…" : dirty ? "Save changes" : "Close"}
            </button>
          </div>
        </div>
      </PinnedFooter>
    </EditorDialog>
  );
}

// ── Add with more details ───────────────────────────────────────────────────

function TodoCreateDialog({ meId, canManage, defaultAssigneeId, initialTitle, focusAfterClose, onClose, onAdded }: {
  meId: number;
  canManage: boolean;
  defaultAssigneeId: number;
  initialTitle: string;
  /** The add box — the cursor goes back there, ready for the next one. */
  focusAfterClose: React.RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onAdded: (task: TodoTask) => void;
}) {
  const [form, setForm] = useState<TodoForm>({ ...EMPTY_TODO_FORM, title: initialTitle });
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId);
  const start: TodoEditable = { title: initialTitle, notes: null, url: null, priority: "normal", scheduled_for: null, due_date: null };
  const dirty = todoEditPatch(start, form) !== null || assigneeId !== defaultAssigneeId;
  const valid = todoFormValid(form);

  const { data: users } = useQuery({
    queryKey: ["todo-users"],
    queryFn: async (): Promise<AppUserRow[]> => jsonOrThrow(await fetch(`${BASE}/api/users`, { credentials: "include" })),
    staleTime: 5 * 60_000,
    enabled: canManage,
  });
  const activeUsers = (users ?? []).filter(u => u.isActive);

  const saveMut = useMutation({
    mutationFn: (): Promise<TodoTask> => post("/api/todos", todoCreateBody(form, assigneeId)),
    onSuccess: (saved) => {
      toast({ title: assigneeId === meId ? "Added to your list" : "Added to their list — they'll be shown it", description: saved.title });
      onAdded(saved);
    },
    onError: (e: Error) => toast({ title: "Couldn't add the task", description: `${e.message} — it's all still here.`, variant: "destructive" }),
  });
  const save = () => { if (valid && !saveMut.isPending) saveMut.mutate(); };

  return (
    <EditorDialog
      open
      onClose={onClose}
      title={<><Plus className="w-6 h-6 text-primary" /> New to-do</>}
      dirty={dirty}
      onSaveRequest={save}
      entityLabel="to-do"
      widthClassName="sm:max-w-3xl"
      noAutoFocus
      onCloseAutoFocus={e => { e.preventDefault(); focusAfterClose.current?.focus({ preventScroll: true }); }}
    >
      <div className="space-y-5 pt-4">
        {/* Who — managers only, create only (reassigning an existing task is
            a delete-and-recreate; keeps the acknowledge story honest). */}
        {canManage && (
          <div>
            <label className="block text-lg font-bold mb-2">Who's it for?</label>
            <select
              value={assigneeId}
              onChange={e => setAssigneeId(Number(e.target.value))}
              className="w-full h-14 px-4 rounded-2xl border-2 border-border bg-card text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value={meId}>Me</option>
              {activeUsers.filter(u => u.id !== meId).map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        )}
        <TodoFields form={form} onChange={setForm} autoFocusTitle={!initialTitle} onEnter={save} />
      </div>
      <PinnedFooter fallback="sticky">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-14 px-5 rounded-2xl border-2 border-border bg-card text-lg font-bold hover:bg-secondary/50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!valid || saveMut.isPending}
            className={cn(
              "flex-1 min-h-14 rounded-2xl text-lg font-bold flex items-center justify-center gap-2 transition-colors",
              valid ? "bg-[#7cb342] text-white hover:bg-[#6a9c37] disabled:opacity-60" : "bg-muted text-muted-foreground cursor-not-allowed",
            )}
          >
            {saveMut.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
            {saveMut.isPending ? "Adding…" : "Add it"}
          </button>
        </div>
      </PinnedFooter>
    </EditorDialog>
  );
}

// ── The fields, shared by the edit pop-up and "add with more details" ──────

function TodoFields({ form, onChange, autoFocusTitle = false, onEnter }: {
  form: TodoForm;
  onChange: (f: TodoForm) => void;
  autoFocusTitle?: boolean;
  /** Enter in the title box — saves. */
  onEnter?: () => void;
}) {
  const titleRef = useNoScrollAutoFocus<HTMLInputElement>(autoFocusTitle);
  const set = (p: Partial<TodoForm>) => onChange({ ...form, ...p });
  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="todo-title" className="block text-lg font-bold mb-2">What needs doing?</label>
        <input
          id="todo-title"
          ref={titleRef}
          value={form.title}
          onChange={e => set({ title: e.target.value })}
          onKeyDown={e => { if (e.key === "Enter" && onEnter) { e.preventDefault(); onEnter(); } }}
          placeholder="e.g. Deep-clean the pass fridge"
          maxLength={300}
          className="w-full h-16 px-5 rounded-2xl border-2 border-border bg-card text-xl font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div>
        <label htmlFor="todo-notes" className="block text-lg font-bold mb-2">Instructions / notes <span className="font-normal text-muted-foreground">(optional)</span></label>
        <textarea
          id="todo-notes"
          value={form.notes}
          onChange={e => set({ notes: e.target.value })}
          rows={4}
          placeholder="Anything they need to know to do it right."
          className="w-full px-5 py-4 rounded-2xl border-2 border-border bg-card text-lg leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div>
        <label htmlFor="todo-url" className="block text-lg font-bold mb-2">Link <span className="font-normal text-muted-foreground">(optional — SOP, form, page)</span></label>
        <input
          id="todo-url"
          value={form.url}
          onChange={e => set({ url: e.target.value })}
          placeholder="https://…"
          inputMode="url"
          className="w-full h-14 px-5 rounded-2xl border-2 border-border bg-card text-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div>
        <p className="block text-lg font-bold mb-2">Priority</p>
        <div className="grid grid-cols-4 gap-2">
          {(Object.keys(PRIORITY_META) as TodoPriority[]).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => set({ priority: p })}
              aria-pressed={form.priority === p}
              className={cn(
                "h-14 rounded-2xl border-2 text-base md:text-lg font-bold transition-all",
                form.priority === p ? PRIORITY_META[p].solid : "border-border bg-card hover:bg-secondary/50",
              )}
            >
              {PRIORITY_META[p].label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="todo-do-on" className="block text-lg font-bold mb-2">Do it on <span className="font-normal text-muted-foreground">(optional)</span></label>
          <input
            id="todo-do-on"
            type="date"
            value={form.scheduledFor}
            onChange={e => set({ scheduledFor: e.target.value })}
            className="w-full h-14 px-4 rounded-2xl border-2 border-border bg-card text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div>
          <label htmlFor="todo-due" className="block text-lg font-bold mb-2">Due by <span className="font-normal text-muted-foreground">(optional)</span></label>
          <input
            id="todo-due"
            type="date"
            value={form.dueDate}
            onChange={e => set({ dueDate: e.target.value })}
            className="w-full h-14 px-4 rounded-2xl border-2 border-border bg-card text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      </div>
    </div>
  );
}

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

  const completeMut = useCompleteTodo();

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
                onClick={() => completeMut.mutate(task.id)}
                disabled={completeMut.isPending}
                className="flex-shrink-0 w-14 flex items-center justify-center text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                title="Mark it done"
                aria-label={`Mark "${task.title}" done`}
              >
                {completeMut.isPending && completeMut.variables === task.id
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
                </div>
              </button>
            </div>
          );
        })}
      </div>
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
    if (!task.url) return;
    try {
      await ackMut.mutateAsync();
      const { href } = resolveTodoLink(task.url);
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
