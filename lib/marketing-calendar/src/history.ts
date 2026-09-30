/**
 * The human sentence for each change to a marketing event, written once when
 * the change is saved and shown in the event's history ("Tommy moved it from
 * 16–29 Oct to 18–31 Oct"). The person's name is NOT part of the sentence —
 * the screen puts it in front — so the same words work for anyone.
 */
import { daysBetween, formatRange } from "./calendar";

export type HistoryAction = "created" | "edited" | "moved" | "resized" | "deleted";

export interface DateChange {
  action: "moved" | "resized";
  summary: string;
}

/** Moving keeps the length; anything else is a stretch or a shorten. */
export function describeDateChange(
  before: { startDate: string; endDate: string },
  after: { startDate: string; endDate: string },
): DateChange | null {
  if (before.startDate === after.startDate && before.endDate === after.endDate) return null;
  const from = formatRange(before.startDate, before.endDate);
  const to = formatRange(after.startDate, after.endDate);
  const lenBefore = daysBetween(before.startDate, before.endDate);
  const lenAfter = daysBetween(after.startDate, after.endDate);
  if (lenBefore === lenAfter) return { action: "moved", summary: `moved it from ${from} to ${to}` };
  return {
    action: "resized",
    summary: `${lenAfter > lenBefore ? "stretched" : "shortened"} it from ${from} to ${to}`,
  };
}

/** Labels for the editable fields, as a person would say them. */
export const FIELD_LABELS: Record<string, string> = {
  name: "title",
  summary: "summary",
  notes: "notes",
  offer: "offer details",
  eventType: "type",
  channels: "channels",
  audience: "audience",
  status: "status",
};

export type FieldValue = string | string[] | null | undefined;

function same(a: FieldValue, b: FieldValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = Array.isArray(a) ? a : [];
    const y = Array.isArray(b) ? b : [];
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  return (a ?? "") === (b ?? "");
}

export interface FieldChange { from: FieldValue; to: FieldValue }

/** Which fields actually changed (unchanged values in the patch are ignored).
 *  Only keys in `labels` count — events by default, emails pass their own. */
export function diffFields(
  before: Record<string, FieldValue>,
  patch: Record<string, FieldValue>,
  labels: Record<string, string> = FIELD_LABELS,
): Record<string, FieldChange> {
  const out: Record<string, FieldChange> = {};
  for (const key of Object.keys(patch)) {
    if (!(key in labels)) continue;
    if (!same(before[key], patch[key])) out[key] = { from: before[key] ?? null, to: patch[key] ?? null };
  }
  return out;
}

export function joinWithAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Display words for a stored value — "product_launch" → "product launch". */
export function humanise(value: string): string {
  return value.replace(/_/g, " ");
}

/**
 * "renamed it to “Bonfire Box”, changed the status to live and edited the
 * notes". Short values are quoted; long text fields just say they changed.
 */
export function describeFieldChanges(changes: Record<string, FieldChange>): string | null {
  const parts: string[] = [];
  for (const [key, { to }] of Object.entries(changes)) {
    if (key === "name") parts.push(`renamed it to “${String(to ?? "")}”`);
    else if (key === "status" || key === "eventType") parts.push(`changed the ${FIELD_LABELS[key]} to ${humanise(String(to ?? ""))}`);
    else if (key === "channels") {
      const list = Array.isArray(to) ? to : [];
      parts.push(list.length ? `set the channels to ${list.map(humanise).join(", ")}` : "cleared the channels");
    } else if (to == null || to === "") parts.push(`cleared the ${FIELD_LABELS[key]}`);
    else parts.push(`edited the ${FIELD_LABELS[key]}`);
  }
  return parts.length ? joinWithAnd(parts) : null;
}

/** First line of a history row: "Graeme added this", "Tommy moved it …". */
export function historyLine(userName: string | null, summary: string): string {
  const who = userName?.trim() ? userName.trim().split(/\s+/)[0] : "Someone";
  return `${who} ${summary}`;
}
