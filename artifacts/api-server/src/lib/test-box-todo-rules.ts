/**
 * Test-box checklist ticks — the pure rules (tested in
 * test-box-todo-rules.test.ts; the database side is test-box-todos.ts).
 *
 * SOURCE OF TRUTH: the tick on the box (test_box_tasks.done).
 *
 * Test boxes no longer put their tasks on anyone's to-do list (Graeme,
 * 2026-10-20: the to-dos they made — prep the ingredients etc. — were
 * "carnage"). The checklist lives on the box page only. To-dos made before
 * then are left exactly as they are (still linked by
 * test_box_tasks.todo_task_id, so ticking one still ticks the box) for
 * Graeme to review and clear himself.
 */

/**
 * Ticking inside "Order the new ingredients for …" (pure; the database side
 * is cascadeOrderTicks in test-box-todos.ts):
 *   - ticking the parent ticks (or unticks) every ingredient line with it;
 *   - ticking an ingredient line ticks the parent once every line is done,
 *     and unticking one reopens the parent.
 * Returns the OTHER ticks to write (the one ticked is already written).
 */
export function orderTickCascade(input: {
  key: string;
  done: boolean;
  parentKey: string;
  subKeys: readonly string[];
  doneKeys: ReadonlySet<string>;
}): Array<{ key: string; done: boolean }> {
  const { key, done, parentKey, subKeys, doneKeys } = input;
  if (subKeys.length === 0) return [];
  if (key === parentKey) {
    return subKeys.filter(k => doneKeys.has(k) !== done).map(k => ({ key: k, done }));
  }
  if (!subKeys.includes(key)) return [];
  const allDone = subKeys.every(k => (k === key ? done : doneKeys.has(k)));
  return doneKeys.has(parentKey) !== allDone ? [{ key: parentKey, done: allDone }] : [];
}
