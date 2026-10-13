/**
 * Sorting any list of tasks by time, priority or the list's own order — with
 * a second rule for ties (Graeme, 2026-10-13: "sort by time as a first
 * priority, but then the second priority is sorted by priority… two reds,
 * one due 3:00 and one due 4:00 — the 3:00 one, then the 4:00 one, then the
 * next ones after that"). Objective F.
 *
 * One comparator for every task list (Team lists, My To-dos, the station
 * "Your to-dos today" strip, the founder's Schedule). Each list maps its own
 * rows to TaskSortFields; the rules live only here.
 */

export type SortKey = "time" | "priority" | "manual";
export interface SortSpec { primary: SortKey; secondary: SortKey | "none" }

/** What the comparator needs from a task. */
export interface TaskSortFields {
  /** 1 = most important … 4 = least. */
  priority: number;
  /** Any string that sorts chronologically ("15:00", "2026-10-13",
   *  "2026-10-12 09:30"); null = no time, which sorts after timed ones. */
  time: string | null;
  /** Overdue tasks come first when sorting by time. */
  overdue?: boolean;
  /** The list's own order (its manual order, or order added). */
  order: number;
  title: string;
}

export const SORT_KEYS: SortKey[] = ["time", "priority", "manual"];

export const SORT_LABELS: Record<SortKey, string> = {
  time: "Time",
  priority: "Priority",
  manual: "List order",
};

function compareKey(key: SortKey, a: TaskSortFields, b: TaskSortFields): number {
  switch (key) {
    case "priority":
      return a.priority - b.priority;
    case "manual":
      return a.order - b.order;
    case "time": {
      const oa = a.overdue ? 0 : 1, ob = b.overdue ? 0 : 1;
      if (oa !== ob) return oa - ob;
      if (a.time === b.time) return 0;
      if (a.time === null) return 1;
      if (b.time === null) return -1;
      return a.time < b.time ? -1 : 1;
    }
  }
}

export function compareTasks(spec: SortSpec, a: TaskSortFields, b: TaskSortFields): number {
  return compareKey(spec.primary, a, b)
    || (spec.secondary !== "none" && spec.secondary !== spec.primary ? compareKey(spec.secondary, a, b) : 0)
    // Stable tie-break: the list's own order, then the title.
    || a.order - b.order
    || a.title.localeCompare(b.title, "en-GB", { sensitivity: "base" });
}

/** A sorted copy; the input is untouched. Equal rows keep their input order. */
export function sortTasks<T>(items: readonly T[], spec: SortSpec, fields: (item: T) => TaskSortFields): T[] {
  const keyed = items.map((item, i) => ({ item, f: fields(item), i }));
  keyed.sort((x, y) => compareTasks(spec, x.f, y.f) || x.i - y.i);
  return keyed.map(k => k.item);
}

/** "Time, then Priority" — the words on the sort button. */
export function sortSpecLabel(spec: SortSpec): string {
  const first = SORT_LABELS[spec.primary];
  return spec.secondary === "none" || spec.secondary === spec.primary
    ? first
    : `${first}, then ${SORT_LABELS[spec.secondary]}`;
}

/** Reads a stored choice back; anything unrecognised falls back to `fallback`. */
export function parseSortSpec(raw: string | null | undefined, fallback: SortSpec): SortSpec {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw) as Partial<SortSpec>;
    const primary = SORT_KEYS.includes(v.primary as SortKey) ? (v.primary as SortKey) : null;
    const secondary = v.secondary === "none" || SORT_KEYS.includes(v.secondary as SortKey) ? (v.secondary as SortKey | "none") : null;
    if (!primary || !secondary) return fallback;
    return { primary, secondary: secondary === primary ? "none" : secondary };
  } catch {
    return fallback;
  }
}

/** My To-dos keep the order they always had: priority first, then date. */
export const TODO_DEFAULT_SORT: SortSpec = { primary: "priority", secondary: "time" };

/** Remembered-choice key for one person's to-do list (the same list on the
 *  sheet, the station strip and the founder's Schedule). */
export const todoSortListKey = (assigneeId: number) => `todos-${assigneeId}`;

/** Personal to-dos: urgent/high/normal/low → 1–4. */
export const TODO_PRIORITY_RANK: Record<string, number> = { urgent: 1, high: 2, normal: 3, low: 4 };

/** A personal to-do's sort fields. Its "time" is the first date it's in play
 *  — the do-on day or the due day, whichever is earlier; manual = order added. */
export function todoSortFields(t: {
  id: number; title: string; priority: string; scheduled_for: string | null; due_date: string | null; created_at: string;
}, opts: { overdue: boolean; order: number }): TaskSortFields {
  const dates = [t.scheduled_for, t.due_date].filter((d): d is string => !!d).map(d => d.slice(0, 10)).sort();
  return {
    priority: TODO_PRIORITY_RANK[t.priority] ?? 3,
    time: dates[0] ?? null,
    overdue: opts.overdue,
    order: opts.order,
    title: t.title,
  };
}

type TodoLike = Parameters<typeof todoSortFields>[0];

/** Sorts personal to-dos; "List order" is the order they were added. */
export function sortTodos<T extends TodoLike>(tasks: readonly T[], spec: SortSpec, isOverdue: (t: T) => boolean): T[] {
  const added = [...tasks].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id));
  const order = new Map(added.map((t, i) => [t.id, i]));
  return sortTasks(tasks, spec, t => todoSortFields(t, { overdue: isOverdue(t), order: order.get(t.id) ?? 0 }));
}
