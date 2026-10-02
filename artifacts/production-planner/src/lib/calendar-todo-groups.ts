/**
 * To-dos on a busy calendar day collapse into one chip (Graeme, 2026-10-02:
 * a test box's launch day showed eight to-do chips stacked down the cell).
 * Up to MAX_TODO_CHIPS_PER_DAY show one by one; more than that become a
 * single "N to-dos" chip that opens the list. Pure.
 */
export const MAX_TODO_CHIPS_PER_DAY = 2;

export type TodoDayItem<T> = { kind: "one"; date: string; todo: T } | { kind: "group"; date: string; todos: T[] };

export function groupTodosByDay<T extends { date: string; done: boolean }>(todos: readonly T[], max = MAX_TODO_CHIPS_PER_DAY): TodoDayItem<T>[] {
  const byDay = new Map<string, T[]>();
  for (const t of todos) (byDay.get(t.date) ?? byDay.set(t.date, []).get(t.date)!).push(t);
  const out: TodoDayItem<T>[] = [];
  for (const [date, list] of [...byDay].sort(([a], [b]) => a.localeCompare(b))) {
    // Open ones first, so the list reads as "what's left".
    const sorted = [...list].sort((a, b) => Number(a.done) - Number(b.done));
    if (sorted.length > max) out.push({ kind: "group", date, todos: sorted });
    else for (const t of sorted) out.push({ kind: "one", date, todo: t });
  }
  return out;
}

/** "8 to-dos" / "8 to-dos · 3 done". */
export function todoGroupLabel(todos: readonly { done: boolean }[]): string {
  const done = todos.filter(t => t.done).length;
  return `${todos.length} to-dos${done ? ` · ${done} done` : ""}`;
}
