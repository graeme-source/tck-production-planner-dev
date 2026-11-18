/**
 * Reasons to Buy (Graeme, 18 Nov 2026): "a list of things that we're going
 * to enter ... automatically detect whether an email fits that category ...
 * tells us when we last did that particular offer ... order them oldest
 * first", where "if we send 4 emails in a week about the same thing, that's
 * one instance of it being used". Pure rules; the matching itself (Claude
 * reading each email) is the server's. Objective I.
 */

export interface ReasonDef {
  id: number;
  name: string;
  description: string | null;
}

/** One sent email that used a reason, with Klaviyo's results for it. */
export interface ReasonEmail {
  campaignId: string;
  /** London day it sent. */
  date: string;
  subject: string | null;
  name: string;
  recipients: number;
  orders: number;
  revenue: number;
}

/** One use: a run of emails about the same reason with no long gap. */
export interface ReasonUse {
  from: string;
  to: string;
  emails: ReasonEmail[];
  recipients: number;
  orders: number;
  revenue: number;
}

export interface ReasonSummary {
  reason: ReasonDef;
  /** Newest first. */
  uses: ReasonUse[];
  lastUse: ReasonUse | null;
  /** Whole days from the end of the last use to today; null = never used. */
  daysSince: number | null;
}

/** Emails this many days apart or more are separate uses. */
export const USE_GAP_DAYS = 10;

const dayNum = (d: string) => Date.parse(`${d}T12:00:00Z`) / 86_400_000;
const daysBetween = (a: string, b: string) => Math.round(dayNum(b) - dayNum(a));
const pennies = (n: number) => Math.round(n * 100) / 100;

/** The reasons list as the matcher saw it: a changed name or description
 *  means every email is read again. */
export function reasonsSignature(reasons: readonly ReasonDef[]): string {
  const text = [...reasons]
    .sort((a, b) => a.id - b.id)
    .map(r => `${r.id}|${r.name.trim()}|${(r.description ?? "").trim()}`)
    .join("\n");
  // FNV-1a — short and stable; not security.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `v1-${reasons.length}-${h.toString(16)}`;
}

/** A reason's emails as separate uses, newest first. */
export function groupUses(emails: readonly ReasonEmail[], gapDays = USE_GAP_DAYS): ReasonUse[] {
  const sorted = [...emails].sort((a, b) => a.date.localeCompare(b.date) || a.campaignId.localeCompare(b.campaignId));
  const uses: ReasonUse[] = [];
  for (const e of sorted) {
    const cur = uses[uses.length - 1];
    if (cur && daysBetween(cur.to, e.date) < gapDays) {
      cur.emails.push(e);
      cur.to = e.date;
    } else {
      uses.push({ from: e.date, to: e.date, emails: [e], recipients: 0, orders: 0, revenue: 0 });
    }
  }
  for (const u of uses) {
    u.recipients = u.emails.reduce((s, e) => s + e.recipients, 0);
    u.orders = u.emails.reduce((s, e) => s + e.orders, 0);
    u.revenue = pennies(u.emails.reduce((s, e) => s + e.revenue, 0));
  }
  return uses.reverse();
}

/** Every reason with its uses, the least recently used first: never-used
 *  reasons at the top (in the list's own order), then the oldest last use. */
export function summariseReasons(
  reasons: readonly ReasonDef[],
  emailsByReason: ReadonlyMap<number, readonly ReasonEmail[]>,
  today: string,
): ReasonSummary[] {
  const rows = reasons.map((reason, order) => {
    const uses = groupUses(emailsByReason.get(reason.id) ?? []);
    const lastUse = uses[0] ?? null;
    return { order, summary: { reason, uses, lastUse, daysSince: lastUse ? Math.max(0, daysBetween(lastUse.to, today)) : null } };
  });
  rows.sort((a, b) => {
    const da = a.summary.lastUse?.to ?? null;
    const db = b.summary.lastUse?.to ?? null;
    if (da == null && db == null) return a.order - b.order;
    if (da == null) return -1;
    if (db == null) return 1;
    return da.localeCompare(db) || a.order - b.order;
  });
  return rows.map(r => r.summary);
}

/** "Not used for 7 weeks", "Used 3 days ago", "Never used". */
export function sinceWords(daysSince: number | null): string {
  if (daysSince == null) return "Never used";
  if (daysSince === 0) return "Used today";
  if (daysSince === 1) return "Used yesterday";
  if (daysSince < 14) return `Not used for ${daysSince} days`;
  const weeks = Math.floor(daysSince / 7);
  if (daysSince < 70) return `Not used for ${weeks} weeks`;
  const months = Math.floor(daysSince / 30.4);
  return `Not used for ${months} months`;
}

/** An email's HTML as plain words for the matcher: no styles, scripts or
 *  tags, entities decoded, spaces collapsed, capped. */
export function emailText(html: string | null | undefined, max = 2500): string {
  if (!html) return "";
  const text = html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&pound;/gi, "£").replace(/&#163;/g, "£")
    .replace(/&quot;/gi, "\"").replace(/&#39;|&rsquo;|&lsquo;/gi, "'").replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
