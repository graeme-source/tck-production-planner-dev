/**
 * Half-typed to-do text, kept (25 Nov 2026, Objective G: "Back never loses
 * typed text"). In the docked panel you leave a page with Back, by opening
 * another list, by going to a station — none of that asks "discard?", so what
 * was typed has to still be there afterwards: a comment not sent yet, the add
 * box, a new to-do being filled in.
 *
 * Kept for this browser tab only (sessionStorage), per person — a shared iPad
 * never shows one person's half-typed text to the next. Editing an existing
 * to-do saves as you type; a draft of it exists only until that save lands.
 *
 * Pure — the React side is hooks/use-todo-draft.ts.
 */
import { EMPTY_TODO_FORM, todoCreateBody, type TodoForm, type TodoFormPriority } from "./todo-edit";

/** What's being typed, per person. */
export type TodoDraftSlot =
  | { kind: "comment"; taskId: number }
  | { kind: "subtask"; taskId: number }
  /** The add box on someone's list (your own, or one a manager is looking at). */
  | { kind: "add"; listUserId: number }
  | { kind: "create" }
  /** An edit that hasn't reached the server yet. */
  | { kind: "edit"; taskId: number };

export function todoDraftKey(userId: number, slot: TodoDraftSlot): string {
  const what = slot.kind === "create" ? "create" : slot.kind === "add" ? `add:${slot.listUserId}` : `${slot.kind}:${slot.taskId}`;
  return `tck_todo_draft:${userId}:${what}`;
}

/** A new to-do being filled in. `assigneeId` is whose list it was started on. */
export interface TodoCreateDraft {
  form: TodoForm;
  assigneeId: number | null;
}

export const EMPTY_CREATE_DRAFT: TodoCreateDraft = { form: EMPTY_TODO_FORM, assigneeId: null };

const PRIORITIES: TodoFormPriority[] = ["urgent", "high", "normal", "low"];

export function parseTextDraft(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const v = JSON.parse(raw) as unknown;
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}

function formFrom(x: unknown): TodoForm | null {
  if (!x || typeof x !== "object") return null;
  const f = x as Partial<Record<keyof TodoForm, unknown>>;
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    title: text(f.title), notes: text(f.notes), url: text(f.url),
    priority: PRIORITIES.includes(f.priority as TodoFormPriority) ? (f.priority as TodoFormPriority) : "normal",
    scheduledFor: text(f.scheduledFor), dueDate: text(f.dueDate),
  };
}

export function parseCreateDraft(raw: string | null | undefined): TodoCreateDraft {
  if (!raw) return EMPTY_CREATE_DRAFT;
  try {
    const v = JSON.parse(raw) as { form?: unknown; assigneeId?: unknown } | null;
    const form = formFrom(v?.form);
    if (!form) return EMPTY_CREATE_DRAFT;
    return { form, assigneeId: typeof v?.assigneeId === "number" && Number.isInteger(v.assigneeId) ? v.assigneeId : null };
  } catch {
    return EMPTY_CREATE_DRAFT;
  }
}

/** An edit on its way to the server: what it was typed over, and what it says. */
export interface TodoEditDraft {
  base: TodoForm;
  form: TodoForm;
}

export function parseEditDraft(raw: string | null | undefined): TodoEditDraft | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { base?: unknown; form?: unknown } | null;
    const base = formFrom(v?.base);
    const form = formFrom(v?.form);
    return base && form ? { base, form } : null;
  } catch {
    return null;
  }
}

/** Put a kept edit back on the to-do as it is NOW: only the fields the person
 *  changed, so anything someone else changed meanwhile stands. */
export function applyEditDraft(current: TodoForm, d: TodoEditDraft): TodoForm {
  const out: TodoForm = { ...current };
  if (d.form.title !== d.base.title) out.title = d.form.title;
  if (d.form.notes !== d.base.notes) out.notes = d.form.notes;
  if (d.form.url !== d.base.url) out.url = d.form.url;
  if (d.form.priority !== d.base.priority) out.priority = d.form.priority;
  if (d.form.scheduledFor !== d.base.scheduledFor) out.scheduledFor = d.form.scheduledFor;
  if (d.form.dueDate !== d.base.dueDate) out.dueDate = d.form.dueDate;
  return out;
}

/** Has anything been typed or picked worth keeping? (Who it's for alone isn't.) */
export function createDraftStarted(d: TodoCreateDraft): boolean {
  const b = todoCreateBody(d.form, 0);
  return b.title !== "" || b.notes !== null || b.url !== null || b.priority !== "normal" || b.scheduledFor !== null || b.dueDate !== null;
}

/** "Add with more details" from the add box: carry on with one already
 *  started, filling its title only if it has none; otherwise start from
 *  what's in the box, for the list it was started on (so wandering off to
 *  another list and back never changes who it's for). Nothing already typed
 *  is replaced. */
export function startCreateDraft(current: TodoCreateDraft, boxTitle: string, listUserId: number): TodoCreateDraft {
  const title = boxTitle.trim();
  if (!createDraftStarted(current)) return { assigneeId: listUserId, form: { ...EMPTY_TODO_FORM, title } };
  if (!title || current.form.title.trim() !== "") return current;
  return { ...current, form: { ...current.form, title } };
}
