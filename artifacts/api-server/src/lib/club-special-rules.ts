/**
 * Club Special changeover rules — pure, no DB or network (tested in
 * club-special-rules.test.ts). The database + Shopify side lives in
 * club-special-changeover.ts. Objectives F and I.
 *
 * Dates are London calendar days as "YYYY-MM-DD" strings throughout.
 *
 * Timeline of one changeover (delivering from D, switching on S):
 *   - when it's scheduled → to-do: in Zapiet, stop Club Special delivery
 *     dates from D (so nobody orders the old recipe's price for a date that
 *     will carry the new one);
 *   - on S (default D − billing offset, so renewals billed from S carry the
 *     new recipe) → the app flips the planner + website, then to-do: in
 *     Zapiet, open Club Special dates from D onwards and close those before.
 * Zapiet's product date restrictions can't be set through its API, hence
 * the two to-dos rather than automation.
 */

import { addDaysToDateString as addDays } from "./london-time";

export { addDays };
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Monday 22 September" */
export function longDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

/** Default switch day: the delivery date minus the subscription billing
 *  offset (renewals billed that day deliver on the new recipe). Never in
 *  the past — a late schedule switches today. */
export function defaultSwitchOn(deliveringFrom: string, offsetDays: number, today: string): string {
  const s = addDays(deliveringFrom, -offsetDays);
  return s < today ? today : s;
}

export interface ScheduleInput {
  deliveringFrom: string;
  switchOn: string;
  today: string;
  /** delivering_from of every live (not cancelled) changeover */
  liveDeliveringFrom: string[];
}

/** Plain-English reason the changeover can't be scheduled, or null. */
export function scheduleProblem(i: ScheduleInput): string | null {
  if (!DATE_RE.test(i.deliveringFrom) || !DATE_RE.test(i.switchOn)) return "Pick both dates.";
  if (i.deliveringFrom <= i.today) return "The first delivery date has to be after today.";
  if (i.switchOn < i.today) return "The switch day can't be in the past.";
  if (i.switchOn > i.deliveringFrom) return "The website has to switch on or before the first delivery date.";
  if (i.liveDeliveringFrom.includes(i.deliveringFrom)) {
    return `A changeover already starts delivering on ${longDay(i.deliveringFrom)} — cancel that one first.`;
  }
  return null;
}

export interface ChangeoverLike {
  id: number;
  status: string;
  switchOn: string;
  deliveringFrom: string;
}

/** Scheduled changeovers whose switch day has arrived, oldest first. If
 *  several are due (the server was down), they are applied in order and
 *  the last one wins — exactly as if each had run on its day. */
export function dueChangeovers<T extends ChangeoverLike>(rows: T[], today: string): T[] {
  return rows
    .filter(r => r.status === "scheduled" && r.switchOn <= today)
    .sort((a, b) => (a.switchOn === b.switchOn ? a.deliveringFrom.localeCompare(b.deliveringFrom) : a.switchOn.localeCompare(b.switchOn)));
}

/** The next changeover still to come after the current one, if any. */
export function nextScheduled<T extends ChangeoverLike>(rows: T[]): T | null {
  const upcoming = rows.filter(r => r.status === "scheduled").sort((a, b) => a.switchOn.localeCompare(b.switchOn));
  return upcoming[0] ?? null;
}

export interface ZapietTodo {
  key: "end" | "start";
  title: string;
  notes: string;
  dueDate: string;
}

/** The two manual Zapiet steps as to-dos for the owner. */
export function zapietTodos(c: {
  recipeName: string;
  deliveringFrom: string;
  switchOn: string;
  today: string;
  clubPricePence: number | null;
}): ZapietTodo[] {
  const lastOld = addDays(c.deliveringFrom, -1);
  const price = c.clubPricePence != null ? ` and its new price (${formatPence(c.clubPricePence)})` : "";
  return [
    {
      key: "end",
      title: `Zapiet: Club Special last delivery date ${longDay(lastOld)}`,
      notes:
        `${c.recipeName} becomes the Calzone Club Special for deliveries from ${longDay(c.deliveringFrom)}. ` +
        `In Zapiet → Local delivery → product date restrictions, set the Calzone Club Special so it can't be ` +
        `delivered after ${longDay(lastOld)}. That stops anyone ordering the current recipe's price for a date ` +
        `that will get the new one. The website switches by itself on ${longDay(c.switchOn)}.`,
      dueDate: c.today,
    },
    {
      key: "start",
      title: `Zapiet: open Club Special dates from ${longDay(c.deliveringFrom)}`,
      notes:
        `Today the website switched the Calzone Club Special to ${c.recipeName}${price}. ` +
        `In Zapiet → Local delivery → product date restrictions, allow Calzone Club Special delivery dates from ` +
        `${longDay(c.deliveringFrom)} onwards, and none before.`,
      dueDate: c.switchOn,
    },
  ];
}
