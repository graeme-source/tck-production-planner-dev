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
 *                      anyone's), task detail with comment timeline, and
 *                      the add/edit form.
 *   TodoInterstitial — app-wide takeover shown when someone ELSE has put
 *                      a task on my list that I haven't acknowledged.
 *                      Rendered once in Layout; polls quietly.
 *   useMyOpenTodoCount — badge feed for buttons that open the sheet.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isBefore, isToday, parseISO } from "date-fns";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, CalendarDays, Check, CheckCircle2, ChevronRight, Circle, ClipboardList,
  ExternalLink, Flag, Loader2, MessageSquare, Pencil, Plus, RotateCcw,
  Send, Trash2, X,
} from "lucide-react";

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

const PRIORITY_META: Record<TodoPriority, { label: string; bar: string; chip: string; solid: string }> = {
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

async function fetchTask(id: number): Promise<TodoTask & { comments: TodoComment[] }> {
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

function dayLabel(iso: string): string {
  const d = parseISO(iso);
  if (isToday(d)) return "Today";
  return format(d, "EEE d MMM");
}

function isOverdue(task: TodoTask): boolean {
  if (task.status !== "open" || !task.due_date) return false;
  const d = parseISO(task.due_date);
  return isBefore(d, new Date()) && !isToday(d);
}

/** Open-task count for the current user — feeds button badges. */
export function useMyOpenTodoCount(): number {
  const { data } = useQuery({
    queryKey: ["todos", "mine"],
    queryFn: () => fetchList("mine"),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  return data?.open.length ?? 0;
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
  const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  let host = url;
  try { host = new URL(href).hostname.replace(/^www\./, ""); } catch { /* show raw */ }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl border-2 border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-bold hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors",
        big ? "px-5 py-3.5 text-lg" : "px-4 py-2 text-base",
      )}
    >
      <ExternalLink className={big ? "w-5 h-5" : "w-4 h-4"} />
      Open link — {host}
    </a>
  );
}

// ── The full-screen sheet ───────────────────────────────────────────────────

type SheetView =
  | { kind: "list" }
  | { kind: "detail"; taskId: number }
  | { kind: "edit"; task: TodoTask }
  | { kind: "create" };

export function TodoSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state } = useAuth();
  const me = state.status === "authenticated" ? state.user : null;
  const canManage = me?.role === "admin" || me?.role === "manager";

  const [view, setView] = useState<SheetView>({ kind: "list" });
  const [viewUserId, setViewUserId] = useState<number | null>(null); // null = me

  // Reset to my list every time the sheet opens.
  useEffect(() => {
    if (open) { setView({ kind: "list" }); setViewUserId(null); }
  }, [open]);

  if (!open || !me) return null;

  const effectiveUserId = viewUserId ?? me.id;

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 md:px-6 py-3 border-b border-border flex-shrink-0">
        {view.kind !== "list" ? (
          <button
            onClick={() => setView({ kind: "list" })}
            className="flex items-center gap-2 px-4 h-14 rounded-2xl bg-secondary hover:bg-secondary/70 text-lg font-bold transition-colors"
          >
            <ArrowLeft className="w-6 h-6" /> Back
          </button>
        ) : (
          <h2 className="font-display font-bold text-2xl md:text-3xl flex items-center gap-3">
            <ClipboardList className="w-8 h-8 text-primary" />
            {viewUserId === null ? "My To-dos" : "To-do list"}
          </h2>
        )}
        <div className="flex-1" />
        <button
          onClick={onClose}
          aria-label="Close to-dos"
          className="w-14 h-14 rounded-2xl bg-secondary hover:bg-secondary/70 flex items-center justify-center transition-colors"
        >
          <X className="w-7 h-7" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-5 pb-24">
          {view.kind === "list" && (
            <TodoList
              meId={me.id}
              canManage={canManage}
              viewUserId={effectiveUserId}
              onSwitchUser={id => setViewUserId(id === me.id ? null : id)}
              onOpenTask={id => setView({ kind: "detail", taskId: id })}
              onCreate={() => setView({ kind: "create" })}
            />
          )}
          {view.kind === "detail" && (
            <TodoDetail
              taskId={view.taskId}
              meId={me.id}
              canManage={canManage}
              onEdit={task => setView({ kind: "edit", task })}
              onGone={() => setView({ kind: "list" })}
            />
          )}
          {(view.kind === "create" || view.kind === "edit") && (
            <TodoEditor
              meId={me.id}
              canManage={canManage}
              defaultAssigneeId={effectiveUserId}
              task={view.kind === "edit" ? view.task : null}
              onDone={task => setView(task ? { kind: "detail", taskId: task.id } : { kind: "list" })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── List view ───────────────────────────────────────────────────────────────

function TodoList({ meId, canManage, viewUserId, onSwitchUser, onOpenTask, onCreate }: {
  meId: number;
  canManage: boolean;
  viewUserId: number;
  onSwitchUser: (id: number) => void;
  onOpenTask: (id: number) => void;
  onCreate: () => void;
}) {
  const isMine = viewUserId === meId;
  const { data, isLoading, error } = useQuery({
    queryKey: isMine ? ["todos", "mine"] : ["todos", "user", viewUserId],
    queryFn: () => fetchList(isMine ? "mine" : viewUserId),
    staleTime: 15_000,
  });

  const { data: users } = useQuery({
    queryKey: ["todo-users"],
    queryFn: async (): Promise<AppUserRow[]> => jsonOrThrow(await fetch(`${BASE}/api/users`, { credentials: "include" })),
    staleTime: 5 * 60_000,
    enabled: canManage,
  });
  const activeUsers = (users ?? []).filter(u => u.isActive);

  const [showDone, setShowDone] = useState(false);

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

      <button
        onClick={onCreate}
        className="w-full h-16 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center justify-center gap-3 hover:opacity-90 active:scale-[0.99] transition-all shadow-lg shadow-primary/20"
      >
        <Plus className="w-7 h-7" />
        {isMine ? "Add a to-do" : "Add to this list"}
      </button>

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

      <div className="space-y-3">
        {data?.open.map(task => <TodoCard key={task.id} task={task} onOpen={() => onOpenTask(task.id)} />)}
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
              {data.done.map(task => <TodoCard key={task.id} task={task} onOpen={() => onOpenTask(task.id)} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TodoCard({ task, onOpen }: { task: TodoTask; onOpen: () => void }) {
  const meta = PRIORITY_META[task.priority];
  const overdue = isOverdue(task);
  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-2xl border-2 border-border bg-card hover:border-primary/50 active:scale-[0.995] transition-all overflow-hidden flex shadow-sm"
    >
      <div className={cn("w-2.5 flex-shrink-0", meta.bar)} />
      <div className="flex-1 min-w-0 p-4 md:p-5">
        <div className="flex items-start gap-3">
          <p className={cn(
            "flex-1 text-xl md:text-2xl font-bold leading-snug break-words",
            task.status === "done" && "line-through text-muted-foreground",
          )}>
            {task.title}
          </p>
          <ChevronRight className="w-6 h-6 text-muted-foreground flex-shrink-0 mt-1" />
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
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
      </div>
    </button>
  );
}

// ── Detail view ─────────────────────────────────────────────────────────────

function TodoDetail({ taskId, meId, canManage, onEdit, onGone }: {
  taskId: number;
  meId: number;
  canManage: boolean;
  onEdit: (task: TodoTask) => void;
  onGone: () => void;
}) {
  const qc = useQueryClient();
  const { data: task, isLoading, error } = useQuery({
    queryKey: ["todo", taskId],
    queryFn: () => fetchTask(taskId),
    staleTime: 5_000,
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [comment, setComment] = useState("");
  const commentsEndRef = useRef<HTMLDivElement>(null);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["todo", taskId] });
    qc.invalidateQueries({ queryKey: ["todos"] });
  }

  const completeMut = useMutation({
    mutationFn: (done: boolean) => post(`/api/todos/${taskId}/${done ? "complete" : "reopen"}`),
    onSuccess: invalidate,
    onError: (e: Error) => toast({ title: "Couldn't update the task", description: e.message, variant: "destructive" }),
  });
  const deleteMut = useMutation({
    mutationFn: () => fetch(`${BASE}/api/todos/${taskId}`, { method: "DELETE", credentials: "include" }).then(jsonOrThrow),
    onSuccess: () => { invalidate(); onGone(); toast({ title: "Task deleted" }); },
    onError: (e: Error) => toast({ title: "Couldn't delete the task", description: e.message, variant: "destructive" }),
  });
  const commentMut = useMutation({
    mutationFn: (body: string) => post(`/api/todos/${taskId}/comments`, { body }),
    onSuccess: () => {
      setComment("");
      invalidate();
      setTimeout(() => commentsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 150);
    },
    onError: (e: Error) => toast({ title: "Comment didn't send", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-16 text-muted-foreground gap-3 text-lg"><Loader2 className="w-6 h-6 animate-spin" /> Loading…</div>;
  }
  if (error != null || !task) {
    return <div className="p-5 rounded-2xl bg-destructive/10 text-destructive text-lg font-semibold">This task is gone — it may have been deleted.</div>;
  }

  const meta = PRIORITY_META[task.priority];
  const canEdit = canManage || task.assignee_id === meId;
  const canDelete = canManage || task.created_by === meId;
  const isDone = task.status === "done";

  return (
    <div className="space-y-5">
      {/* Title block with priority bar */}
      <div className="rounded-2xl border-2 border-border bg-card overflow-hidden flex shadow-sm">
        <div className={cn("w-3 flex-shrink-0", meta.bar)} />
        <div className="p-5 md:p-6 flex-1 min-w-0">
          <h1 className={cn("text-3xl md:text-4xl font-display font-bold leading-tight break-words", isDone && "line-through text-muted-foreground")}>
            {task.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2.5 mt-4">
            <PriorityChip p={task.priority} big />
            {task.scheduled_for && <DateChip label="Do" iso={task.scheduled_for} big />}
            {task.due_date && <DateChip label="Due" iso={task.due_date} overdue={isOverdue(task)} big />}
          </div>
          <p className="text-base text-muted-foreground mt-4 font-medium">
            For <strong className="text-foreground">{task.assignee_name}</strong>
            {task.created_by_name ? <> · added by <strong className="text-foreground">{task.created_by_name}</strong></> : null}
            {task.acknowledged_at ? <> · <span className="text-primary font-semibold">seen ✓</span></> : null}
          </p>
        </div>
      </div>

      {task.notes && (
        <div className="rounded-2xl bg-secondary/40 p-5">
          <p className="text-xl leading-relaxed whitespace-pre-wrap">{task.notes}</p>
        </div>
      )}

      {task.url && <LinkButton url={task.url} big />}

      {/* Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={() => completeMut.mutate(!isDone)}
          disabled={completeMut.isPending}
          className={cn(
            "h-16 rounded-2xl text-xl font-bold flex items-center justify-center gap-3 transition-all active:scale-[0.99] disabled:opacity-50 sm:col-span-2",
            isDone ? "bg-secondary hover:bg-secondary/70" : "bg-primary text-primary-foreground hover:opacity-90 shadow-lg shadow-primary/20",
          )}
        >
          {completeMut.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : isDone ? <RotateCcw className="w-6 h-6" /> : <Check className="w-7 h-7" />}
          {isDone ? "Put it back on the list" : "Mark it done"}
        </button>
        {canEdit && (
          <button
            onClick={() => onEdit(task)}
            className="h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 transition-colors"
          >
            <Pencil className="w-5 h-5" /> Edit
          </button>
        )}
        {canDelete && (
          confirmDelete ? (
            <button
              onClick={() => deleteMut.mutate()}
              disabled={deleteMut.isPending}
              className="h-14 rounded-2xl bg-destructive text-destructive-foreground text-lg font-bold flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50"
            >
              {deleteMut.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
              Really delete?
            </button>
          ) : (
            <button
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
            className="flex-1 h-14 px-4 rounded-2xl border-2 border-border bg-card text-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
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
  );
}

// ── Create / edit form ──────────────────────────────────────────────────────

function TodoEditor({ meId, canManage, defaultAssigneeId, task, onDone }: {
  meId: number;
  canManage: boolean;
  defaultAssigneeId: number;
  task: TodoTask | null; // null = create
  onDone: (task: TodoTask | null) => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [url, setUrl] = useState(task?.url ?? "");
  const [priority, setPriority] = useState<TodoPriority>(task?.priority ?? "normal");
  const [scheduledFor, setScheduledFor] = useState(task?.scheduled_for ?? "");
  const [dueDate, setDueDate] = useState(task?.due_date ?? "");
  const [assigneeId, setAssigneeId] = useState(task?.assignee_id ?? defaultAssigneeId);

  const { data: users } = useQuery({
    queryKey: ["todo-users"],
    queryFn: async (): Promise<AppUserRow[]> => jsonOrThrow(await fetch(`${BASE}/api/users`, { credentials: "include" })),
    staleTime: 5 * 60_000,
    enabled: canManage,
  });
  const activeUsers = (users ?? []).filter(u => u.isActive);

  const saveMut = useMutation({
    mutationFn: async (): Promise<TodoTask> => {
      const common = {
        title: title.trim(),
        notes: notes.trim() || null,
        url: url.trim() || null,
        priority,
        scheduledFor: scheduledFor || null,
        dueDate: dueDate || null,
      };
      if (task) {
        return fetch(`${BASE}/api/todos/${task.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(common),
        }).then(jsonOrThrow);
      }
      return post("/api/todos", { ...common, assigneeId });
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["todos"] });
      if (task) qc.invalidateQueries({ queryKey: ["todo", task.id] });
      toast({ title: task ? "Task updated" : assigneeId === meId ? "Added to your list" : "Added to their list — they'll be shown it" });
      onDone(saved);
    },
    onError: (e: Error) => toast({ title: "Couldn't save the task", description: e.message, variant: "destructive" }),
  });

  return (
    <form
      className="space-y-5"
      onSubmit={e => { e.preventDefault(); if (title.trim()) saveMut.mutate(); }}
    >
      <h2 className="text-2xl md:text-3xl font-display font-bold">{task ? "Edit task" : "New to-do"}</h2>

      {/* Who — managers only, create only (reassigning an existing task is
          a delete-and-recreate; keeps the acknowledge story honest). */}
      {canManage && !task && (
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

      <div>
        <label className="block text-lg font-bold mb-2">What needs doing?</label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Deep-clean the pass fridge"
          autoFocus
          className="w-full h-16 px-5 rounded-2xl border-2 border-border bg-card text-xl font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div>
        <label className="block text-lg font-bold mb-2">Instructions / notes <span className="font-normal text-muted-foreground">(optional)</span></label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={4}
          placeholder="Anything they need to know to do it right."
          className="w-full px-5 py-4 rounded-2xl border-2 border-border bg-card text-lg leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div>
        <label className="block text-lg font-bold mb-2">Link <span className="font-normal text-muted-foreground">(optional — SOP, form, page)</span></label>
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://…"
          inputMode="url"
          className="w-full h-14 px-5 rounded-2xl border-2 border-border bg-card text-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div>
        <label className="block text-lg font-bold mb-2">Priority</label>
        <div className="grid grid-cols-4 gap-2">
          {(Object.keys(PRIORITY_META) as TodoPriority[]).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setPriority(p)}
              className={cn(
                "h-14 rounded-2xl border-2 text-base md:text-lg font-bold transition-all",
                priority === p ? PRIORITY_META[p].solid : "border-border bg-card hover:bg-secondary/50",
              )}
            >
              {PRIORITY_META[p].label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-lg font-bold mb-2">Do it on <span className="font-normal text-muted-foreground">(optional)</span></label>
          <input
            type="date"
            value={scheduledFor}
            onChange={e => setScheduledFor(e.target.value)}
            className="w-full h-14 px-4 rounded-2xl border-2 border-border bg-card text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div>
          <label className="block text-lg font-bold mb-2">Due by <span className="font-normal text-muted-foreground">(optional)</span></label>
          <input
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            className="w-full h-14 px-4 rounded-2xl border-2 border-border bg-card text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={!title.trim() || saveMut.isPending}
        className="w-full h-16 rounded-2xl bg-primary text-primary-foreground text-xl font-bold flex items-center justify-center gap-3 hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-40 shadow-lg shadow-primary/20"
      >
        {saveMut.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : <Check className="w-7 h-7" />}
        {task ? "Save changes" : "Add it"}
      </button>
    </form>
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
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["todos", "mine"],
    queryFn: () => fetchList("mine"),
    enabled: !!me,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const todayIso = format(new Date(), "yyyy-MM-dd");
  const todays = (data?.open ?? []).filter(t => !t.scheduled_for || t.scheduled_for <= todayIso);

  const completeMut = useMutation({
    mutationFn: (id: number) => post(`/api/todos/${id}/complete`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["todos"] }),
    onError: (e: Error) => toast({ title: "Couldn't mark it done", description: e.message, variant: "destructive" }),
  });

  if (!me || todays.length === 0) {
    // Even with nothing due, managers/users may want the sheet from here —
    // but an empty band would be noise on a busy checklist. Render nothing.
    return null;
  }

  return (
    <div className="rounded-xl border-2 border-primary/30 bg-primary/5 overflow-hidden">
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
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
                onClick={() => setSheetOpen(true)}
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
      <TodoSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
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
    queryKey: ["todos", "unacknowledged"],
    queryFn: fetchUnacknowledged,
    enabled: loggedIn,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const [question, setQuestion] = useState("");
  const [askOpen, setAskOpen] = useState(false);

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

  if (!task || meId === null) return null;

  const meta = PRIORITY_META[task.priority];

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4 md:p-8 overflow-y-auto">
      <div className="bg-background rounded-3xl border border-border shadow-2xl max-w-2xl w-full my-auto overflow-hidden">
        <div className={cn("h-3", meta.bar)} />
        <div className="p-6 md:p-8 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-lg font-bold text-muted-foreground uppercase tracking-wide">
              New to-do for you
              {pending && pending.length > 1 ? ` · 1 of ${pending.length}` : ""}
            </p>
            <PriorityChip p={task.priority} big />
          </div>

          <h1 className="text-3xl md:text-5xl font-display font-bold leading-tight break-words">{task.title}</h1>

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

          {task.url && <LinkButton url={task.url} big />}

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

          <button
            onClick={() => ackMut.mutate()}
            disabled={ackMut.isPending}
            className="w-full h-20 rounded-2xl bg-primary text-primary-foreground text-2xl font-bold flex items-center justify-center gap-3 hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50 shadow-lg shadow-primary/25"
          >
            {ackMut.isPending ? <Loader2 className="w-7 h-7 animate-spin" /> : <CheckCircle2 className="w-8 h-8" />}
            {question.trim() ? "Send question — seen it" : "Seen it — understood"}
          </button>
        </div>
      </div>
    </div>
  );
}
