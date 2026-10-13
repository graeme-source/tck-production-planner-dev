/**
 * The to-do pop-up's edit form (Graeme, 2026-10-13: "I just want to be able
 * to edit it from the main to-do list, and then save, and then it goes back
 * to the to-do list"). Objectives F and I.
 *
 *   todoFormFrom(task)       — the form's starting values
 *   todoEditPatch(task, form) — only what changed, in the PATCH /api/todos/:id
 *                               shape, or null when nothing did (the save
 *                               button stays grey; closing asks nothing)
 *   todoCreateBody(form, assigneeId) — POST /api/todos body
 *
 * Only changed fields are sent, so a save never rewrites a field someone
 * else changed while the pop-up was open. Blank text counts as "nothing"
 * (the server stores null), and text is trimmed before comparing.
 *
 * Pure — unit-tested in todo-edit.test.ts.
 */

export type TodoFormPriority = "urgent" | "high" | "normal" | "low";

export interface TodoForm {
  title: string;
  notes: string;
  url: string;
  priority: TodoFormPriority;
  /** yyyy-mm-dd or "" */
  scheduledFor: string;
  /** yyyy-mm-dd or "" */
  dueDate: string;
}

export interface TodoEditable {
  title: string;
  notes: string | null;
  url: string | null;
  priority: TodoFormPriority;
  scheduled_for: string | null;
  due_date: string | null;
}

export interface TodoPatch {
  title?: string;
  notes?: string | null;
  url?: string | null;
  priority?: TodoFormPriority;
  scheduledFor?: string | null;
  dueDate?: string | null;
}

export const EMPTY_TODO_FORM: TodoForm = {
  title: "", notes: "", url: "", priority: "normal", scheduledFor: "", dueDate: "",
};

export function todoFormFrom(task: TodoEditable): TodoForm {
  return {
    title: task.title,
    notes: task.notes ?? "",
    url: task.url ?? "",
    priority: task.priority,
    scheduledFor: task.scheduled_for ?? "",
    dueDate: task.due_date ?? "",
  };
}

const textOrNull = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
};

export function todoEditPatch(task: TodoEditable, form: TodoForm): TodoPatch | null {
  const patch: TodoPatch = {};
  const title = form.title.trim();
  if (title !== task.title.trim()) patch.title = title;
  if (textOrNull(form.notes) !== textOrNull(task.notes)) patch.notes = textOrNull(form.notes);
  if (textOrNull(form.url) !== textOrNull(task.url)) patch.url = textOrNull(form.url);
  if (form.priority !== task.priority) patch.priority = form.priority;
  if (textOrNull(form.scheduledFor) !== textOrNull(task.scheduled_for)) patch.scheduledFor = textOrNull(form.scheduledFor);
  if (textOrNull(form.dueDate) !== textOrNull(task.due_date)) patch.dueDate = textOrNull(form.dueDate);
  return Object.keys(patch).length === 0 ? null : patch;
}

/** A form can be saved only with a title (the server needs one). */
export function todoFormValid(form: TodoForm): boolean {
  return form.title.trim() !== "";
}

const PRIORITY_RANK: Record<TodoFormPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export interface TodoSortable {
  id: number;
  priority: TodoFormPriority;
  due_date: string | null;
  scheduled_for: string | null;
  created_at: string;
}

/**
 * Put a just-added task where the server will list it, so it appears in
 * place straight away (and the highlight scrolls to the right spot) rather
 * than jumping when the list refreshes. Same order as GET /api/todos/mine:
 * priority, due date (none last), "do it on" date (none last), oldest first.
 */
export function insertOpenTodo<T extends TodoSortable>(open: T[], task: T): T[] {
  const nullsLast = (a: string | null, b: string | null) =>
    a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1;
  const cmp = (a: T, b: T) =>
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || nullsLast(a.due_date, b.due_date)
    || nullsLast(a.scheduled_for, b.scheduled_for)
    || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id);
  const rest = open.filter(t => t.id !== task.id);
  const at = rest.findIndex(t => cmp(task, t) < 0);
  return at === -1 ? [...rest, task] : [...rest.slice(0, at), task, ...rest.slice(at)];
}

export function todoCreateBody(form: TodoForm, assigneeId: number) {
  return {
    assigneeId,
    title: form.title.trim(),
    notes: textOrNull(form.notes),
    url: textOrNull(form.url),
    priority: form.priority,
    scheduledFor: textOrNull(form.scheduledFor),
    dueDate: textOrNull(form.dueDate),
  };
}
