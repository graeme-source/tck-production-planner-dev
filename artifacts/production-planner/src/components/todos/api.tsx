/**
 * Personal to-dos: the types, the server calls and the hooks every to-do
 * screen shares (the docked panel, the full-screen sheet, the station strip,
 * the founder's Schedule). Objectives F and G.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isBefore, isToday, parseISO } from "date-fns";
import type { ParentTickChoice } from "@workspace/subtasks";
import { useAuth } from "@/contexts/auth-context";
import { TEAM_LISTS_KEY } from "@/components/team-lists/team-lists-api";
import { ParentTickPrompt, useParentTickGuard, type SubtaskView } from "@/components/subtasks/subtask-ui";
import { toast } from "@/hooks/use-toast";
import type { TodoPatch } from "@/lib/todo-edit";

export const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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
  /** Its sub-tasks, in order, each with its own tick (Graeme, 25 Nov 2026).
   *  Never counted as to-dos of their own. */
  subtasks?: TodoSubtask[];
  /** Started from a team-list "When needed" process. */
  source_team_list_item_id?: number | null;
  source_item_title?: string | null;
  source_list_id?: number | null;
  source_list_name?: string | null;
}

export interface TodoSubtask {
  id: number;
  task_id: number;
  title: string;
  notes: string | null;
  url: string | null;
  sort_order: number;
  done_at: string | null;
  done_by: number | null;
  done_by_name: string | null;
}

export function subtaskViews(task: Pick<TodoTask, "subtasks">): SubtaskView[] {
  return (task.subtasks ?? []).map(s => ({ id: s.id, title: s.title, notes: s.notes, url: s.url, doneAt: s.done_at, doneByName: s.done_by_name }));
}

export interface TodoAttachment {
  id: number;
  kind: "image" | "video";
  mime: string;
  file_name: string | null;
  uploaded_by: number | null;
  uploaded_by_name: string | null;
  created_at: string;
}

export interface TodoComment {
  id: number;
  user_id: number | null;
  user_name: string | null;
  kind: "comment" | "event";
  body: string;
  created_at: string;
}

export interface AppUserRow { id: number; name: string; role: string; isActive: boolean }

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

export async function jsonOrThrow(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Request failed");
  return data;
}

export async function fetchList(userId: number | "mine"): Promise<{ open: TodoTask[]; done: TodoTask[] }> {
  const path = userId === "mine" ? "/api/todos/mine" : `/api/todos/user/${userId}`;
  return jsonOrThrow(await fetch(`${BASE}${path}`, { credentials: "include" }));
}

export async function fetchTask(id: number): Promise<TodoTask & { comments: TodoComment[]; attachments: TodoAttachment[] }> {
  return jsonOrThrow(await fetch(`${BASE}/api/todos/${id}`, { credentials: "include" }));
}

export async function fetchUnacknowledged(): Promise<TodoTask[]> {
  return jsonOrThrow(await fetch(`${BASE}/api/todos/unacknowledged`, { credentials: "include" }));
}

export function post(path: string, body?: unknown) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).then(jsonOrThrow);
}

// Timestamps arrive as "2026-08-20 11:14:57.203857" (no T, no zone) — treat
// as UTC-naive local; only used for display so close enough is fine.
export function parseTs(s: string): Date {
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

/** A to-do started from a team list changes its master's "Last run" and
 *  "Open now" lines — refresh any team list on screen when one is ticked. */
export function refreshProcessRuns(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: TEAM_LISTS_KEY });
}

/** Tick a to-do off, with the same visible failure everywhere it's offered.
 *  `subtasks` = the answer to "Tick the N left as well?" (useParentTickGuard);
 *  the server refuses a to-do with unticked sub-tasks without one. */
export function useCompleteTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, subtasks }: { id: number; subtasks?: ParentTickChoice }) =>
      post(`/api/todos/${id}/complete`, subtasks ? { subtasks } : undefined),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["todos"] }); refreshProcessRuns(qc); },
    onError: (e: Error) => toast({ title: "Couldn't mark it done", description: e.message, variant: "destructive" }),
  });
}

/** Tick a to-do off from a list row: asks first when sub-tasks are left
 *  ("Tick the 4 left as well?"). Render `prompt` once in the component. */
export function useGuardedCompleteTodo() {
  const completeMut = useCompleteTodo();
  const guard = useParentTickGuard();
  async function complete(task: TodoTask) {
    const choice = await guard.choose(subtaskViews(task), task.title);
    if (choice === null) return;
    completeMut.mutate({ id: task.id, subtasks: choice });
  }
  return {
    complete,
    isPending: completeMut.isPending,
    pendingId: completeMut.isPending ? completeMut.variables?.id ?? null : null,
    prompt: <ParentTickPrompt asking={guard.asking} answer={guard.answer} />,
  };
}

/** Tick or untick one sub-task of a to-do. */
export function useTickTodoSubtask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, done }: { id: number; done: boolean }) => post(`/api/todo-subtasks/${id}/tick`, { done }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["todos"] });
      void qc.invalidateQueries({ queryKey: ["todo"] });
    },
    onError: (e: Error) => toast({ title: "Couldn't tick it", description: e.message, variant: "destructive" }),
  });
}

function send(path: string, method: string, body?: unknown) {
  return fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).then(jsonOrThrow);
}

export const todoSubtaskApi = (taskId: number) => ({
  add: (title: string) => send(`/api/todo-subtasks/task/${taskId}`, "POST", { title }),
  patch: (id: number, data: { title: string; notes: string | null; url: string | null }) => send(`/api/todo-subtasks/${id}`, "PATCH", data),
  remove: (id: number) => send(`/api/todo-subtasks/${id}`, "DELETE"),
  reorder: (ids: number[]) => send(`/api/todo-subtasks/task/${taskId}/reorder`, "POST", { subtaskIds: ids }),
});

export function patchTodo(id: number, patch: TodoPatch): Promise<TodoTask> {
  return send(`/api/todos/${id}`, "PATCH", patch);
}

/** Whose list a manager can look at or add to: everyone active. */
export function useTodoPeople(canManage: boolean) {
  const { data: users } = useQuery({
    queryKey: ["todo-users"],
    queryFn: async (): Promise<AppUserRow[]> => jsonOrThrow(await fetch(`${BASE}/api/users`, { credentials: "include" })),
    staleTime: 5 * 60_000,
    enabled: canManage,
  });
  return (users ?? []).filter(u => u.isActive);
}

/** Open-task count for the current user — feeds button badges. */
export function useMyOpenTodoCount(): number {
  return useMyTodos().data?.open.length ?? 0;
}

export function listKeyFor(meId: number, userId: number) {
  // Both branches carry the user id — see the note in useMyTodos.
  return userId === meId ? ["todos", "mine", meId] : ["todos", "user", userId];
}
