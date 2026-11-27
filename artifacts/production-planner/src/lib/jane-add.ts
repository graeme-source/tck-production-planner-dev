/**
 * AI Jane as the go-between for adding things (Graeme, 27 Nov 2026; the
 * server half is api-server lib/ai/jane-add-actions.ts). Jane's chat stream
 * sends one of two events:
 *
 *   add_form  → open that Quick actions form, filled in from what was said.
 *               The person finishes and sends it there, exactly as before.
 *   add_draft → a card with exactly what will be added (a to-do on their own
 *               list, or a Wish List item) and an "Add it" button that calls
 *               the existing endpoint as them.
 *
 * Pure: reading the events, the card's wording and the request bodies.
 * Unit-tested in jane-add.test.ts.
 */
import { EMPTY_TODO_FORM, todoCreateBody } from "./todo-edit";
import { WISH_LIST_NAME } from "./wish-list";
import { REPORT_INCIDENT_LABEL } from "./incident-kinds";

/** Every Quick action that adds something (layout.tsx QuickActionsPanel). */
export const JANE_ADD_KINDS = ["improvement", "issue", "incident", "defect", "wish_list", "todo", "receipt", "kanban"] as const;
export type JaneAddKind = (typeof JANE_ADD_KINDS)[number];

export interface JaneFormRequest {
  kind: JaneAddKind;
  title?: string;
  text?: string;
  area?: "factory" | "system";
  safety?: boolean;
  mode?: "idea" | "done";
  link?: string;
}

export type TodoPriority = "urgent" | "high" | "normal" | "low";

export type JaneDraft =
  | { kind: "todo"; title: string; notes: string | null; priority: TodoPriority; dueDate: string | null }
  | { kind: "wish_list"; title: string; notes: string | null; quantity: number };

/** The Quick actions button each form is, word for word. */
export const JANE_FORM_LABEL: Record<JaneAddKind, string> = {
  improvement: "Improvement",
  issue: "Report issue",
  incident: REPORT_INCIDENT_LABEL,
  defect: "Report defect / waste",
  wish_list: `Add to ${WISH_LIST_NAME}`,
  todo: "My to-dos",
  receipt: "Add receipt or invoice",
  kanban: "Pull kanban",
};

const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

const isKind = (v: unknown): v is JaneAddKind => typeof v === "string" && (JANE_ADD_KINDS as readonly string[]).includes(v);

/** The add_form event's request, or null if it isn't one. */
export function readFormEvent(data: unknown): JaneFormRequest | null {
  const r = (data as { request?: Record<string, unknown> } | null)?.request;
  if (!r || !isKind(r.kind)) return null;
  const out: JaneFormRequest = { kind: r.kind };
  const title = str(r.title, 300); if (title) out.title = title;
  const text = str(r.text, 5000); if (text) out.text = text;
  if (r.area === "factory" || r.area === "system") out.area = r.area;
  if (r.safety === true) out.safety = true;
  if (r.mode === "idea" || r.mode === "done") out.mode = r.mode;
  const link = str(r.link, 4000); if (link && /^https?:\/\//i.test(link)) out.link = link;
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES: TodoPriority[] = ["urgent", "high", "normal", "low"];

/** The add_draft event's draft and its id, or null if it isn't one. */
export function readDraftEvent(data: unknown): { id: string; draft: JaneDraft } | null {
  const e = data as { id?: unknown; draft?: Record<string, unknown> } | null;
  const d = e?.draft;
  const title = str(d?.title, 300);
  if (!d || !title || typeof e?.id !== "string") return null;
  const notes = str(d.notes, 2000) ?? null;
  if (d.kind === "todo") {
    const priority = PRIORITIES.includes(d.priority as TodoPriority) ? d.priority as TodoPriority : "normal";
    const dueDate = typeof d.dueDate === "string" && DATE_RE.test(d.dueDate) ? d.dueDate : null;
    return { id: e.id, draft: { kind: "todo", title, notes, priority, dueDate } };
  }
  if (d.kind === "wish_list") {
    const q = typeof d.quantity === "number" && Number.isFinite(d.quantity) ? Math.min(1000, Math.max(1, Math.round(d.quantity))) : 1;
    return { id: e.id, draft: { kind: "wish_list", title, notes, quantity: q } };
  }
  return null;
}

/** The card's heading. */
export const draftHeading = (d: JaneDraft): string =>
  d.kind === "todo" ? "Add to your to-do list?" : `Add to the ${WISH_LIST_NAME}?`;

const PRIORITY_WORD: Record<TodoPriority, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };

/** "Fri 28 Nov" from YYYY-MM-DD, without the time zone moving the day. */
export function dayWord(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** Exactly what will be created, as label/value rows for the card. */
export function draftRows(d: JaneDraft): Array<{ label: string; value: string }> {
  const rows = [{ label: d.kind === "todo" ? "To-do" : "What's needed", value: d.title }];
  if (d.notes) rows.push({ label: "Notes", value: d.notes });
  if (d.kind === "todo") {
    rows.push({ label: "Priority", value: PRIORITY_WORD[d.priority] });
    if (d.dueDate) rows.push({ label: "Due", value: dayWord(d.dueDate) });
  } else {
    rows.push({ label: "How many", value: String(d.quantity) });
  }
  return rows;
}

/** POST /api/todos — the same body the to-do form sends, on their own list. */
export function todoBodyFor(d: Extract<JaneDraft, { kind: "todo" }>, meId: number) {
  return todoCreateBody({ ...EMPTY_TODO_FORM, title: d.title, notes: d.notes ?? "", priority: d.priority, dueDate: d.dueDate ?? "" }, meId);
}

/** POST /api/wish-list — what the Wish List form sends when you type rather than paste a link. */
export function wishBodyFor(d: Extract<JaneDraft, { kind: "wish_list" }>) {
  return { url: null, title: d.title, notes: d.notes, quantity: d.quantity };
}

/** What Jane says in the chat once it's added. */
export function addedLine(d: JaneDraft, wish?: { duplicate: boolean; message?: string }): string {
  if (d.kind === "todo") return `Added "${d.title}" to your to-do list.`;
  if (wish?.duplicate) return `${wish.message ?? "Already on the list — added your vote instead"}: "${d.title}".`;
  return `Added "${d.title}" to the ${WISH_LIST_NAME}, with your vote.`;
}
