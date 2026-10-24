/**
 * Adding what the smart add box worked out, through each list's own endpoint
 * (so permissions, notifications and timelines stay where they are), and
 * taking it back off again for Undo.
 */
import { addDays, describeRule, type RecurrenceRule } from "@workspace/recurrence";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type Destination =
  | { kind: "todo"; assigneeId: number }
  | { kind: "team_list"; listId: number }
  | { kind: "checklist"; stationType: string; category: "opening" | "cleaning" | "closing" };

/** Where the box sits — the AI's default when the words don't say. */
export type SmartAddContext =
  | { kind: "todo"; assigneeId?: number }
  | { kind: "team_list"; listId: number }
  | { kind: "checklist"; stationType: string; category: "opening" | "cleaning" | "closing"; planId?: number };

export interface Placement {
  destination: Destination;
  destinationLabel: string;
  title: string;
  priority: 1 | 2 | 3 | 4 | null;
  rule: RecurrenceRule | null;
  ruleLabel: string | null;
  date: string | null;
  dateKind: "on" | "by" | null;
  time: string | null;
  checklistToday: boolean;
  problem: string | null;
  ai: boolean;
}

export interface AddedTask {
  kind: "todo" | "team_list_item" | "checklist_template" | "checklist_oneoff";
  id: number;
  title: string;
  destination: Destination;
  destinationLabel: string;
  /** "every Thursday", "on Mon 26 Oct", "by Fri 30 Oct", "today". */
  when: string;
  /** The row the endpoint sent back. */
  row: unknown;
}

async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method, credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = (data as { error?: unknown }).error;
    throw new Error(typeof err === "string" ? err : `HTTP ${r.status}`);
  }
  return data as T;
}

const TODO_PRIORITY = { 1: "urgent", 2: "high", 3: "normal", 4: "low" } as const;

function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function describeWhen(p: { rule: RecurrenceRule | null; date: string | null; dateKind: "on" | "by" | null; time: string | null }, today?: string): string {
  const at = p.time ? ` at ${p.time}` : "";
  if (p.rule) {
    const r = describeRule(p.rule);
    return `${r.charAt(0).toLowerCase()}${r.slice(1)}${at}`;
  }
  if (p.date) {
    const word = today && p.date === today ? "today" : today && p.date === addDays(today, 1) ? "tomorrow" : shortDate(p.date);
    const pre = p.dateKind === "by" ? "by " : word === "today" || word === "tomorrow" ? "" : "on ";
    return `${pre}${word}${at}`;
  }
  return "";
}

/** Add it where the server said, and say what happened. */
export async function addPlacement(p: Placement, context: SmartAddContext, today: string): Promise<AddedTask> {
  const d = p.destination;
  const base = { title: p.title, destination: d, destinationLabel: p.destinationLabel };
  if (d.kind === "todo") {
    const row = await send<{ id: number }>("/api/todos", "POST", {
      assigneeId: d.assigneeId, title: p.title, notes: null, url: null,
      priority: p.priority ? TODO_PRIORITY[p.priority] : "normal",
      scheduledFor: p.date && p.dateKind !== "by" ? p.date : null,
      dueDate: p.date && p.dateKind === "by" ? p.date : null,
      recurrence: p.rule, timeOfDay: p.time,
    });
    const when = describeWhen(p, today) || "no date — on the list now";
    return { ...base, kind: "todo", id: row.id, when, row };
  }
  if (d.kind === "team_list") {
    const recurrence: RecurrenceRule = p.rule ?? (p.date ? { kind: "once", date: p.date } : { kind: "daily" });
    // Same carry-over default as the list's own box: daily rhythms don't
    // pile up, anything less often stays until ticked.
    const carryOver = !(recurrence.kind === "daily" || recurrence.kind === "weekdays");
    const row = await send<{ id: number }>(`/api/team-lists/${d.listId}/items`, "POST", {
      title: p.title, priority: p.priority ?? 4, recurrence, carryOver,
      ...(p.time ? { timeOfDay: p.time } : {}),
    });
    return { ...base, kind: "team_list_item", id: row.id, row, when: describeWhen({ ...p, rule: p.rule ?? (p.date ? null : { kind: "daily" }) }, today) };
  }
  if (p.checklistToday && context.kind === "checklist" && context.planId) {
    const row = await send<{ id: number }>("/api/checklists/oneoff", "POST", {
      planId: context.planId, stationType: d.stationType, category: d.category, title: p.title,
    });
    return { ...base, kind: "checklist_oneoff", id: row.id, when: "today only", row };
  }
  const days = p.rule && p.rule.kind === "weekly" ? p.rule.days : null;
  const schedule = !p.rule || p.rule.kind === "daily"
    ? { schedule: "daily" }
    : p.rule.kind === "weekdays"
      ? { schedule: "specific_days", scheduleDays: ["monday", "tuesday", "wednesday", "thursday", "friday"] }
      : { schedule: "specific_days", scheduleDays: (days ?? []).map(n => ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][n]) };
  const row = await send<{ id: number }>("/api/checklists/templates", "POST", {
    stationType: d.stationType, category: d.category, title: p.title, orderPosition: 999, ...schedule,
  });
  return { ...base, kind: "checklist_template", id: row.id, row, when: describeWhen({ ...p, rule: p.rule ?? { kind: "daily" } }, today) };
}

export async function undoAdded(a: AddedTask): Promise<void> {
  if (a.kind === "todo") await send(`/api/todos/${a.id}`, "DELETE");
  else if (a.kind === "team_list_item") await send(`/api/team-lists/items/${a.id}`, "PATCH", { active: false });
  else if (a.kind === "checklist_template") await send(`/api/checklists/templates/${a.id}`, "DELETE");
  else await send(`/api/checklists/oneoff/${a.id}`, "DELETE");
}
