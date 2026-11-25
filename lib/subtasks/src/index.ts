/**
 * Sub-tasks and "When needed" processes — the pure rules, shared by the
 * server and the screens (Graeme, 25 Nov 2026). No database, no network.
 *
 *   Sub-tasks   Any task — a team-list task or a personal to-do, one-off or
 *               repeating — can have an ordered list of sub-tasks. On a
 *               team list they belong to the master and have no ticks; on a
 *               to-do each has its own tick (who and when).
 *   Progress    "3 of 7": ticked of all. Sub-tasks are never counted as
 *               to-dos of their own — a to-do with 7 sub-tasks is one to-do.
 *   Parent tick Ticking a to-do off while some of its sub-tasks are still
 *               unticked never silently loses them: the person is asked
 *               "Tick the 4 left as well?" and chooses — tick them all and
 *               finish, or finish and leave them unticked (said on the
 *               timeline). The server refuses a tick that hasn't chosen.
 *   Start now   Starting a "When needed" process copies the master task and
 *               all its sub-tasks into a new to-do on the starter's own
 *               list, for today — a snapshot: later edits to the master
 *               never change it. Starting it twice makes two copies; with
 *               one already open the person is asked first.
 *   Last run    The master card says when it was last finished and by
 *               whom, from its copies.
 */

// ── Progress ────────────────────────────────────────────────────────────────

export interface TickableSubtask {
  id: number;
  /** When it was ticked; null/undefined = not ticked. Required (not `?`) so
   *  a row with a differently named column (the to-dos' `done_at`) can't be
   *  passed in by mistake and read as all unticked. */
  doneAt: string | Date | null | undefined;
}

export interface SubtaskProgress { total: number; done: number; left: number }

export function isSubtaskDone(s: TickableSubtask): boolean {
  return s.doneAt != null;
}

export function subtaskProgress(subtasks: readonly TickableSubtask[] | null | undefined): SubtaskProgress {
  const list = subtasks ?? [];
  const done = list.filter(isSubtaskDone).length;
  return { total: list.length, done, left: list.length - done };
}

/** The chip on a to-do with sub-tasks: "3 of 7". Empty when there are none. */
export function progressLabel(p: SubtaskProgress): string {
  return p.total === 0 ? "" : `${p.done} of ${p.total}`;
}

/** The chip on a team-list master (no ticks there): "7 sub-tasks". */
export function subtaskCountLabel(n: number): string {
  if (n <= 0) return "";
  return `${n} sub-task${n === 1 ? "" : "s"}`;
}

// ── Ticking the parent ─────────────────────────────────────────────────────

export type ParentTickChoice = "tick_all" | "leave";

export type ParentTickDecision =
  | { kind: "tick" }
  | { kind: "ask"; left: number; question: string; tickAllLabel: string; leaveLabel: string };

/** What happens when someone ticks a to-do off: straight through when every
 *  sub-task is ticked (or there are none), otherwise ask. */
export function parentTickDecision(subtasks: readonly TickableSubtask[] | null | undefined): ParentTickDecision {
  const { left } = subtaskProgress(subtasks);
  if (left === 0) return { kind: "tick" };
  const them = left === 1 ? "the 1 left" : `the ${left} left`;
  return {
    kind: "ask",
    left,
    question: `Tick ${them} as well?`,
    tickAllLabel: left === 1 ? "Yes — tick it and finish" : `Yes — tick all ${left} and finish`,
    leaveLabel: left === 1 ? "Finish, leave it unticked" : `Finish, leave ${left} unticked`,
  };
}

export type ParentTickResolution =
  | { ok: true; tickSubtaskIds: number[]; timelineNote: string | null }
  | { ok: false; left: number; error: string };

/** The server's side of the same rule: which sub-tasks to tick along with
 *  the parent, and what to say on the timeline — or a refusal when there
 *  are unticked sub-tasks and no choice was made. */
export function resolveParentTick(
  subtasks: readonly TickableSubtask[] | null | undefined,
  choice: ParentTickChoice | null | undefined,
): ParentTickResolution {
  const list = subtasks ?? [];
  const open = list.filter(s => !isSubtaskDone(s));
  if (open.length === 0) return { ok: true, tickSubtaskIds: [], timelineNote: null };
  if (choice === "tick_all") {
    return {
      ok: true,
      tickSubtaskIds: open.map(s => s.id),
      timelineNote: `Ticked the last ${open.length === 1 ? "sub-task" : `${open.length} sub-tasks`} along with it`,
    };
  }
  if (choice === "leave") {
    return {
      ok: true,
      tickSubtaskIds: [],
      timelineNote: `Finished with ${open.length} of ${list.length} sub-task${list.length === 1 ? "" : "s"} not ticked`,
    };
  }
  return {
    ok: false,
    left: open.length,
    error: `${open.length} sub-task${open.length === 1 ? " is" : "s are"} still unticked — choose whether to tick ${open.length === 1 ? "it" : "them"} as well`,
  };
}

// ── Start now: the snapshot copy ───────────────────────────────────────────

export type TodoPriority = "urgent" | "high" | "normal" | "low";

/** Team lists use P1–P4 (P4 = no priority, the default); to-dos use words.
 *  P4 is "normal" on a to-do — the to-do default — not "low". */
export const TEAM_TO_TODO_PRIORITY: Record<number, TodoPriority> = { 1: "urgent", 2: "high", 3: "normal", 4: "normal" };

export interface MasterItem {
  id: number;
  title: string;
  notes: string | null;
  url: string | null;
  priority: number;
  timeOfDay: string | null;
}

export interface MasterSubtask {
  id: number;
  title: string;
  notes: string | null;
  url: string | null;
  sortOrder: number;
}

export interface SnapshotSubtask { title: string; notes: string | null; url: string | null; sortOrder: number }

export interface TodoSnapshot {
  title: string;
  notes: string | null;
  url: string | null;
  priority: TodoPriority;
  /** Started for today: on today's list and due today. */
  scheduledFor: string;
  dueDate: string;
  timeOfDay: string | null;
  /** A copy is a one-off: the master is what comes round again. */
  recurrence: null;
  sourceTeamListItemId: number;
  /** In the master's order, renumbered 1…n, none ticked. */
  subtasks: SnapshotSubtask[];
}

/** The new to-do a "Start now" makes, copied from the master as it is right
 *  now. Plain new objects — nothing shared with the master — so editing the
 *  master afterwards can never reach the copy. */
export function snapshotFromMaster(master: MasterItem, subtasks: readonly MasterSubtask[], today: string): TodoSnapshot {
  const ordered = [...subtasks].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  return {
    title: master.title,
    notes: master.notes ?? null,
    url: master.url ?? null,
    priority: TEAM_TO_TODO_PRIORITY[master.priority] ?? "normal",
    scheduledFor: today,
    dueDate: today,
    timeOfDay: master.timeOfDay ?? null,
    recurrence: null,
    sourceTeamListItemId: master.id,
    subtasks: ordered.map((s, i) => ({ title: s.title, notes: s.notes ?? null, url: s.url ?? null, sortOrder: i + 1 })),
  };
}

/** A repeating to-do ticked off makes the next one: its sub-tasks come too,
 *  in order and all unticked. */
export function freshSubtasksFrom(subtasks: readonly MasterSubtask[]): SnapshotSubtask[] {
  return [...subtasks]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map((s, i) => ({ title: s.title, notes: s.notes ?? null, url: s.url ?? null, sortOrder: i + 1 }));
}

/** "From Marketing → Ads checklist" on a started copy. */
export function sourceLabel(listName: string | null | undefined, itemTitle: string | null | undefined): string {
  const list = listName?.trim();
  const item = itemTitle?.trim();
  if (list && item) return `From ${list} → ${item}`;
  if (list) return `From the ${list} list`;
  return "From a team list";
}

// ── Last run ───────────────────────────────────────────────────────────────

export interface ProcessCopy {
  assigneeId: number;
  assigneeName: string | null;
  status: "open" | "done";
  createdAt: string | Date;
  completedAt: string | Date | null;
}

export interface ProcessRuns {
  /** Copies still open, anyone's. */
  openCount: number;
  /** Copies still open on this person's own list — "you already have one open". */
  openMine: number;
  /** Who has one open now, first names in start order, no repeats. */
  openNames: string[];
  /** The most recently finished copy. */
  lastDone: { at: string; byName: string | null } | null;
  /** How many times it's been finished. */
  doneCount: number;
}

function iso(t: string | Date): string {
  return t instanceof Date ? t.toISOString() : t;
}

function when(t: string | Date): number {
  return new Date(iso(t)).getTime();
}

export function processRuns(copies: readonly ProcessCopy[], meId: number | null | undefined): ProcessRuns {
  const open = copies.filter(c => c.status === "open").sort((a, b) => when(a.createdAt) - when(b.createdAt));
  const done = copies.filter(c => c.status === "done" && c.completedAt != null)
    .sort((a, b) => when(b.completedAt!) - when(a.completedAt!));
  const names: string[] = [];
  for (const c of open) {
    const n = (c.assigneeName ?? "Someone").split(" ")[0];
    if (!names.includes(n)) names.push(n);
  }
  return {
    openCount: open.length,
    openMine: meId == null ? 0 : open.filter(c => c.assigneeId === meId).length,
    openNames: names,
    lastDone: done[0] ? { at: iso(done[0].completedAt!), byName: done[0].assigneeName } : null,
    doneCount: done.length,
  };
}

/** "25 Nov" in London time; with the year when it isn't this year. */
function shortDay(at: string, today?: string): string {
  const d = new Date(at);
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ...o }).format(d);
  const year = fmt({ year: "numeric" });
  const thisYear = today ? today.slice(0, 4) : year;
  return year === thisYear ? fmt({ day: "numeric", month: "short" }) : fmt({ day: "numeric", month: "short", year: "numeric" });
}

/** The line on the master card: "Last run 25 Nov by Graeme" — or "Not run
 *  yet". First name only, as elsewhere on the lists. */
export function lastRunLabel(runs: ProcessRuns, today?: string): string {
  if (!runs.lastDone) return "Not run yet";
  const by = runs.lastDone.byName ? ` by ${runs.lastDone.byName.split(" ")[0]}` : "";
  return `Last run ${shortDay(runs.lastDone.at, today)}${by}`;
}

/** "Open now: Graeme" / "Open now: Graeme, Lorna" — or "" when none. */
export function openNowLabel(runs: ProcessRuns): string {
  if (runs.openCount === 0) return "";
  return `Open now: ${runs.openNames.join(", ")}`;
}

// ── Ordering ───────────────────────────────────────────────────────────────

/** Move one id up (-1) or down (+1); the ids unchanged if it can't move. */
export function moveId(ids: readonly number[], id: number, delta: -1 | 1): number[] {
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return [...ids];
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Is this new order the same set of ids as the current one (nothing lost,
 *  nothing added, no repeats)? The server checks a reorder with it. */
export function isSameIdSet(current: readonly number[], proposed: readonly number[]): boolean {
  if (current.length !== proposed.length) return false;
  const a = new Set(current);
  const b = new Set(proposed);
  if (b.size !== proposed.length) return false;
  for (const id of b) if (!a.has(id)) return false;
  return true;
}
