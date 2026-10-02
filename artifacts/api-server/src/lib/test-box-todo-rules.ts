/**
 * Test-box tasks ↔ the owner's to-do list — the pure rules (tested in
 * test-box-todo-rules.test.ts; the database side is test-box-todos.ts).
 *
 * SOURCE OF TRUTH: the tick on the box (test_box_tasks.done). Every task on
 * the box — launch checklist and each delivery's chain — is SHOWN as a
 * to-do on the box owner's list, linked by test_box_tasks.todo_task_id.
 * Ticking either side writes the tick and sets the to-do to match in the
 * same transaction; this plan then re-derives every to-do from the ticks
 * and the dates whenever the box changes, so the two can't drift:
 *
 *   - a task with no to-do (and not ticked) gets one, due on the task's date;
 *   - an open to-do follows the task: title, due date, notes and owner move
 *     with it (a done to-do is history and is left alone);
 *   - a to-do whose open/done disagrees with the tick is set to the tick;
 *   - a to-do whose task no longer exists (delivery removed, public launch
 *     cleared, supplier dropped) or whose box is gone/cancelled is removed
 *     if still open — the tick row stays, so nothing ticked is lost.
 */
import { dayMonth, type ScheduleTask } from "./test-box-schedule";

export interface LinkState { key: string; done: boolean; todoId: number | null }
export interface TodoState { id: number; status: "open" | "done"; assigneeId: number; title: string; dueDate: string | null; notes: string | null }
export interface WantedTodo { key: string; title: string; dueDate: string; notes: string }

export type TodoAction =
  | { kind: "create"; key: string; title: string; dueDate: string; notes: string; assigneeId: number }
  | { kind: "update"; key: string; todoId: number; title: string; dueDate: string; notes: string; assigneeId: number }
  | { kind: "set-status"; key: string; todoId: number; done: boolean }
  | { kind: "remove"; key: string; todoId: number };

/** The to-do's title: the task, plus which box and which delivery. */
export function todoTitle(boxName: string, task: Pick<ScheduleTask, "label">, deliveryDate?: string | null): string {
  let t = task.label;
  if (deliveryDate) {
    const d = dayMonth(deliveryDate);
    if (!t.includes(d)) t = `${t} — ${d} delivery`;
  }
  if (!t.includes(boxName)) t = `${t} (${boxName})`;
  return t.slice(0, 300);
}

/** The to-do's notes: how / detail, ingredients, and a pointer back. */
export function todoNotes(task: Pick<ScheduleTask, "how" | "detail" | "items" | "time">): string {
  return [
    task.time ? `By ${task.time}.` : "",
    task.how ?? "",
    task.detail ?? "",
    task.items?.length ? `Ingredients: ${task.items.join(", ")}.` : "",
    "From the test box — tick it here or on the box; both stay in step.",
  ].filter(Boolean).join("\n").slice(0, 5000);
}

export function planTodoSync(input: {
  wanted: readonly WantedTodo[];
  links: readonly LinkState[];
  todos: ReadonlyMap<number, TodoState>;
  /** null = nobody to give them to. */
  ownerId: number | null;
  /** false when the box is deleted or cancelled. */
  active: boolean;
}): TodoAction[] {
  const actions: TodoAction[] = [];
  const wanted = input.active && input.ownerId != null ? input.wanted : [];
  const wantedKeys = new Set(wanted.map(w => w.key));
  const linkByKey = new Map(input.links.map(l => [l.key, l]));

  for (const w of wanted) {
    const link = linkByKey.get(w.key);
    const todo = link?.todoId != null ? input.todos.get(link.todoId) : undefined;
    const done = link?.done ?? false;
    if (!todo) {
      if (!done) actions.push({ kind: "create", key: w.key, title: w.title, dueDate: w.dueDate, notes: w.notes, assigneeId: input.ownerId! });
      continue;
    }
    if ((todo.status === "done") !== done) actions.push({ kind: "set-status", key: w.key, todoId: todo.id, done });
    if (!done && (todo.title !== w.title || todo.dueDate !== w.dueDate || todo.notes !== w.notes || todo.assigneeId !== input.ownerId)) {
      actions.push({ kind: "update", key: w.key, todoId: todo.id, title: w.title, dueDate: w.dueDate, notes: w.notes, assigneeId: input.ownerId! });
    }
  }

  for (const l of input.links) {
    if (wantedKeys.has(l.key) || l.todoId == null) continue;
    const todo = input.todos.get(l.todoId);
    if (todo && todo.status === "open") actions.push({ kind: "remove", key: l.key, todoId: todo.id });
  }
  return actions;
}
