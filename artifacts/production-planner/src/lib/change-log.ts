/**
 * The Sales & Marketing change log, made short (Graeme, 2026-10-21): "way
 * too much text — confusing and hard to read. Simplify it … keep all the
 * change log entries." Objective I.
 *
 * Entries are grouped by London day, newest first, each ONE line:
 *   "09:14 · Offer · Free delivery threshold £60 → £50"
 * plus, only when the numbers actually say something, a short impact tag:
 *   "Conversion likely lower after (−12%)"
 * The long "fortnight after vs before (same weekdays)" wording, the source
 * line ("From Klaviyo") and the intro text are gone.
 */

export interface ChangeLogImpact {
  effect: number | null;
  likelihood: string;
  leadShift: number | null;
}

export interface ChangeLogEntry {
  id: number;
  effectiveAt: string;
  category: string;
  title: string;
  impact: ChangeLogImpact | null;
}

const TZ = "Europe/London";

function londonParts(iso: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** "09:14" in London time. */
export function changeTime(iso: string): string {
  return londonParts(iso).time;
}

/** "2026-10-21" — the London day a change happened. */
export function changeDay(iso: string): string {
  return londonParts(iso).day;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Tue 21 Oct" — with the year only when it isn't this year ("Mon 30 Dec 2025"). */
export function dayHeading(day: string, today: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const base = `${wd} ${d} ${MONTHS[m - 1]}`;
  if (day === today) return `Today · ${base}`;
  return y === Number(today.slice(0, 4)) ? base : `${base} ${y}`;
}

/** "Offer · Free delivery over £50" — category label then the title, in full. */
export function changeLine(c: ChangeLogEntry, categoryLabel: (c: string) => string): string {
  return `${categoryLabel(c.category)} · ${c.title}`;
}

/**
 * A short impact tag, or null when there's nothing worth saying (not enough
 * data, or no clear difference). The delivery wait gets a few words when it
 * moved too, because then the change may not be the cause.
 */
export function impactTag(impact: ChangeLogImpact | null): { text: string; worse: boolean } | null {
  if (!impact || impact.effect == null) return null;
  const l = impact.likelihood;
  if (!/(lower|higher)$/.test(l)) return null;
  const pct = Math.round(Math.abs(impact.effect) * 100);
  const sign = impact.effect < 0 ? "−" : "+";
  let text = `Conversion ${l} after (${sign}${pct}%)`;
  if (impact.leadShift != null && Math.abs(impact.leadShift) >= 0.5) {
    text += ` · delivery wait ${impact.leadShift > 0 ? "+" : "−"}${Math.abs(impact.leadShift).toFixed(1)} days too`;
  }
  return { text, worse: l.endsWith("lower") };
}

export interface ChangeLogDay<T extends ChangeLogEntry> {
  day: string;
  heading: string;
  entries: T[];
}

/** Newest day first, newest change first within a day. Every entry is kept. */
export function groupChangesByDay<T extends ChangeLogEntry>(changes: T[], today: string): ChangeLogDay<T>[] {
  const sorted = [...changes].sort((a, b) => (a.effectiveAt < b.effectiveAt ? 1 : a.effectiveAt > b.effectiveAt ? -1 : b.id - a.id));
  const out: ChangeLogDay<T>[] = [];
  for (const c of sorted) {
    const day = changeDay(c.effectiveAt);
    const last = out[out.length - 1];
    if (last && last.day === day) last.entries.push(c);
    else out.push({ day, heading: dayHeading(day, today), entries: [c] });
  }
  return out;
}
