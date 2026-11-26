/**
 * Reasons to Buy (Graeme, 18 Nov 2026): "a list of things that we're going
 * to enter ... automatically detect whether an email fits that category ...
 * tells us when we last did that particular offer ... order them oldest
 * first", where "if we send 4 emails in a week about the same thing, that's
 * one instance of it being used". Pure rules; the matching itself (Claude
 * reading each email) is the server's. Objective I.
 */

import { addDays } from "./calendar";

export interface ReasonDef {
  id: number;
  name: string;
  description: string | null;
}

/** Who a reason is usually sent to. Several can be picked. */
export const AUDIENCES = [
  { key: "subscription", label: "Subscription customers" },
  { key: "existing", label: "Existing customers" },
  { key: "not_ordered", label: "Haven't ordered yet" },
] as const;
export type AudienceKey = (typeof AUDIENCES)[number]["key"];

/**
 * How a reason is usually run (Graeme, 18 Nov 2026) — guidance for whoever
 * plans the emails, "not rules that we can definitely not break". Every
 * part is optional. minGapDays is the SHORTEST gap before using it again.
 */
export interface ReasonGuide {
  emailsPerUse: number | null;
  daysPerUse: number | null;
  minGapDays: number | null;
  audiences: AudienceKey[];
}

export type ReasonWithGuide = ReasonDef & ReasonGuide;

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
  /** The email's own words that show the reason (copied by the reader and
   *  checked to be really in the email). */
  evidence?: string | null;
  /** The email in Klaviyo (its report page, where it can be cloned). */
  klaviyoUrl?: string | null;
  /** How it was matched: its Klaviyo tag, or reading the email. */
  source?: "tag" | "read";
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

/** How the emails are read. Bump it when the reading rules change so every
 *  email is read again under the new rules (v2, 18 Nov: strict — the email's
 *  own words must show the reason, after "credit" picked up free-pack emails;
 *  v3, same day: a second strict check of every match, temperature 0, after
 *  a re-read let a free-pack email back in). */
export const READ_RULES_VERSION = 3;

/** The reasons list as the matcher saw it: a changed name or description
 *  (or new reading rules) means every email is read again. */
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
  return `v${READ_RULES_VERSION}-${reasons.length}-${h.toString(16)}`;
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

/** When a reason has rested long enough to use again, going by its
 *  shortest gap: null = no gap set or never used (ready now). */
export function readyFrom(lastUseTo: string | null, minGapDays: number | null): string | null {
  if (!lastUseTo || !minGapDays || minGapDays <= 0) return null;
  return addDays(lastUseTo, minGapDays);
}

/** Ready to use again today? (No gap set, or never used = ready.) */
export function isReady(lastUseTo: string | null, minGapDays: number | null, today: string): boolean {
  const from = readyFrom(lastUseTo, minGapDays);
  return from == null || from <= today;
}

/** How many days before its date a resting reason starts showing as due
 *  soon, so it can be planned in (credit for Black Friday, 18 Nov 2026). */
export const DUE_SOON_DAYS = 14;

export type RestState =
  /** Its shortest gap is a while off yet — yellow. */
  | { kind: "resting"; date: string }
  /** Can be used again within DUE_SOON_DAYS — green. */
  | { kind: "due_soon"; date: string }
  /** Can be used again from today — green. */
  | { kind: "due_today"; date: string }
  /** Could have been used again since `date` and hasn't been — dark green. */
  | { kind: "overdue"; date: string };

/**
 * Where a reason stands against its shortest gap (Graeme, 18 Nov 2026):
 * yellow while resting, green once it's due within two weeks or today, dark
 * green when it's gone past its date unused. null = no gap set or never used.
 * Guidance, not a rule — it can still be used while resting.
 */
export function restState(lastUseTo: string | null, minGapDays: number | null, today: string): RestState | null {
  const date = readyFrom(lastUseTo, minGapDays);
  if (!date) return null;
  if (date < today) return { kind: "overdue", date };
  if (date === today) return { kind: "due_today", date };
  return addDays(today, DUE_SOON_DAYS) >= date ? { kind: "due_soon", date } : { kind: "resting", date };
}

/**
 * The order to plan from: reasons ready to use first, least recently used
 * at the top (never-used first of all); then the ones still resting, the
 * soonest ready first. Stable on the list's own order.
 */
export function planningOrder<T extends { lastUse: { to: string } | null; readyFrom: string | null; ready: boolean }>(rows: readonly T[]): T[] {
  return rows.map((r, i) => ({ r, i })).sort((a, b) => {
    if (a.r.ready !== b.r.ready) return a.r.ready ? -1 : 1;
    if (!a.r.ready) return (a.r.readyFrom ?? "").localeCompare(b.r.readyFrom ?? "") || a.i - b.i;
    const da = a.r.lastUse?.to ?? null;
    const db = b.r.lastUse?.to ?? null;
    if (da == null || db == null) return da == null && db == null ? a.i - b.i : da == null ? -1 : 1;
    return da.localeCompare(db) || a.i - b.i;
  }).map(x => x.r);
}

/** "every 2 months", "every 3 weeks", "every 10 days" — a gap in words. */
export function gapWords(days: number): string {
  if (days % 30 === 0) return days === 30 ? "every month" : `every ${days / 30} months`;
  if (days % 7 === 0) return days === 7 ? "every week" : `every ${days / 7} weeks`;
  return days === 1 ? "every day" : `every ${days} days`;
}

/** The guidance in one line: "4 emails over 7 days · Existing customers ·
 *  at most every 2 months". Empty when nothing is set. */
export function guideWords(g: ReasonGuide): string {
  const parts: string[] = [];
  if (g.emailsPerUse) {
    const emails = `${g.emailsPerUse} email${g.emailsPerUse === 1 ? "" : "s"}`;
    parts.push(g.daysPerUse && g.emailsPerUse > 1 ? `${emails} over ${g.daysPerUse} day${g.daysPerUse === 1 ? "" : "s"}` : emails);
  } else if (g.daysPerUse) {
    parts.push(`runs ${g.daysPerUse} day${g.daysPerUse === 1 ? "" : "s"}`);
  }
  const who = AUDIENCES.filter(a => g.audiences.includes(a.key)).map(a => a.label);
  if (who.length) parts.push(who.join(", "));
  if (g.minGapDays) parts.push(`at most ${gapWords(g.minGapDays)}`);
  return parts.join(" · ");
}

/** "Not used for 7 weeks", "Used 3 days ago", "Not used in the last year" (only a year of emails is read). */
export function sinceWords(daysSince: number | null): string {
  if (daysSince == null) return "Not used in the last year";
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

const plain = (s: string) => s.toLowerCase()
  .replace(/[\u2018\u2019\u201b`´]/g, "'").replace(/[\u201c\u201d]/g, "\"")
  .replace(/[^\p{L}\p{N}£%']+/gu, " ")
  .trim();

/**
 * Is the quoted evidence really in the email? Wrong info is worse than none
 * (Graeme, 18 Nov 2026), so a match only counts when the words the reader
 * quotes are actually there — ignoring case, punctuation, emoji and spacing.
 * Quotes joined with "…" or "..." are checked piece by piece; every piece
 * must be there, and at least one must be two words or more, so a lone
 * "free" or "credit" can't carry it.
 */
export function evidenceFound(evidence: string | null | undefined, emailWords: string): boolean {
  const pieces = (evidence ?? "").split(/…|\.{3,}/).map(plain).filter(Boolean);
  if (!pieces.some(p => p.split(" ").length >= 2)) return false;
  const hay = ` ${plain(emailWords)} `;
  return pieces.every(p => hay.includes(` ${p} `));
}

/** Days back to re-check from the newest saved send, so an email that was
 *  still sending at the last check is picked up once it's sent. */
export const SENT_RECHECK_DAYS = 3;

/**
 * Where to ask Klaviyo from when topping up the saved copy of sent
 * campaigns: a few days before the newest one saved, or the whole lookback
 * the first time (nothing saved yet).
 */
export function sentSyncFrom(newestSaved: string | null, today: string, lookbackDays: number): string {
  const floor = addDays(today, -lookbackDays);
  if (!newestSaved) return floor;
  const from = addDays(newestSaved, -SENT_RECHECK_DAYS);
  return from < floor ? floor : from;
}

// ── Efficacy: which reasons pull the most weight (Graeme, 19 Nov 2026) ──

/** What a reason brings in, averaged over each time it was used in the last
 *  year — so one used often isn't credited with everything across a long run. */
export interface Efficacy {
  /** Klaviyo-credited revenue per use. */
  perUse: number;
  /** …and per email sent for it. */
  perEmail: number;
  ordersPerUse: number;
  uses: number;
}

export function efficacyOf(uses: readonly ReasonUse[]): Efficacy | null {
  if (uses.length === 0) return null;
  const revenue = uses.reduce((s, u) => s + u.revenue, 0);
  const emails = uses.reduce((s, u) => s + u.emails.length, 0);
  const orders = uses.reduce((s, u) => s + u.orders, 0);
  return {
    perUse: pennies(revenue / uses.length),
    perEmail: emails > 0 ? pennies(revenue / emails) : 0,
    ordersPerUse: Math.round(orders / uses.length),
    uses: uses.length,
  };
}

/** Bands by thirds of the ranking (Graeme, 19 Nov 2026: banding against the
 *  best left everything but the £40k winner looking the same): top third,
 *  middle third, bottom third. */
export type EfficacyTier = "top" | "good" | "low";

export function rankEfficacy(items: ReadonlyArray<{ id: number; perUse: number | null }>): Map<number, { rank: number; tier: EfficacyTier }> {
  const ranked = items.filter(i => i.perUse != null && i.perUse > 0).sort((a, b) => b.perUse! - a.perUse! || a.id - b.id);
  const out = new Map<number, { rank: number; tier: EfficacyTier }>();
  const n = ranked.length;
  ranked.forEach((i, idx) => {
    out.set(i.id, { rank: idx + 1, tier: idx < Math.ceil(n / 3) ? "top" : idx < Math.ceil((2 * n) / 3) ? "good" : "low" });
  });
  return out;
}

/** Can it be planned in the next couple of weeks? Ready now (including no gap
 *  set or never used), due soon, due today or overdue — not still resting. */
export function plannableSoon(row: { ready: boolean; rest: RestState | null }): boolean {
  if (row.ready) return true;
  return row.rest != null && row.rest.kind !== "resting";
}

/** Columns the reasons table sorts by, Excel-style (Graeme, 19 Nov 2026). */
export type ReasonSortKey = "name" | "available" | "revenue" | "last";
export interface ReasonSortBy { key: ReasonSortKey; dir: "asc" | "desc" }

/** What a column sorts to on its first click: soonest available, biggest
 *  earner, most recently used, A–Z. */
export const DEFAULT_SORT_DIR: Record<ReasonSortKey, "asc" | "desc"> = { name: "asc", available: "asc", revenue: "desc", last: "desc" };

/** Opening order: available soonest, then what it pulls in. */
export const DEFAULT_REASON_SORT: ReasonSortBy[] = [{ key: "available", dir: "asc" }, { key: "revenue", dir: "desc" }];

/** A header click: the main sort flips direction; any other column becomes
 *  the main sort, the old ones staying behind it as tie-breakers (up to 3). */
export function clickSort(sorts: readonly ReasonSortBy[], key: ReasonSortKey): ReasonSortBy[] {
  if (sorts[0]?.key === key) return [{ key, dir: sorts[0].dir === "asc" ? "desc" : "asc" }, ...sorts.slice(1)];
  return [{ key, dir: DEFAULT_SORT_DIR[key] }, ...sorts.filter(s => s.key !== key)].slice(0, 3);
}

type SortableRow = { reason: { id: number; name: string }; ready: boolean; readyFrom: string | null; lastUse: { to: string } | null };

/** Sort by each column in turn; blanks (never used, no revenue) always last.
 *  Ties keep the order given. */
export function sortReasonRows<T extends SortableRow>(rows: readonly T[], sorts: readonly ReasonSortBy[], perUse: ReadonlyMap<number, number | null>): T[] {
  const value = (r: T, key: ReasonSortKey): string | number | null => {
    switch (key) {
      case "name": return r.reason.name.toLowerCase();
      case "available": return r.ready || r.readyFrom == null ? "" : r.readyFrom;
      case "revenue": return perUse.get(r.reason.id) ?? null;
      case "last": return r.lastUse?.to ?? null;
    }
  };
  return rows.map((r, i) => ({ r, i })).sort((a, b) => {
    for (const s of sorts) {
      const x = value(a.r, s.key), y = value(b.r, s.key);
      if (x === y) continue;
      if (x == null) return 1;
      if (y == null) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      if (c !== 0) return s.dir === "asc" ? c : -c;
    }
    return a.i - b.i;
  }).map(x => x.r);
}


// ── Klaviyo campaign tags (Graeme, 26 Nov 2026) ─────────────────────────────
// "We're going to use tags on those campaigns … pretty much character for
// character to the names of the reasons to buy." A tag is first point of
// call: an email carrying a reason's tag counts for exactly the reasons its
// tags name. Tags that aren't a reason's name (B2B, Winback, Credit Offer…)
// are ignored. An email with no reason tag falls back to being read.

/** A name as a tag might write it: case, spacing and curly quotes don't count. */
export function tagKey(name: string): string {
  return name.normalize("NFKC").replace(/[\u2018\u2019\u02BC`´]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();
}

/** The reason a Klaviyo tag names, or null when it isn't one. */
export function reasonForTag<R extends { id: number; name: string }>(tagName: string, reasons: readonly R[]): R | null {
  const k = tagKey(tagName);
  return k ? reasons.find((r) => tagKey(r.name) === k) ?? null : null;
}

/**
 * Each email's reasons: its reason tags when it has any, otherwise what
 * reading it found. Returns reasonId → why, per campaign.
 */
export function reasonsPerEmail(
  read: ReadonlyMap<string, ReadonlyMap<number, string>>,
  tagged: ReadonlyMap<string, ReadonlyArray<{ reasonId: number; tag: string }>>,
): Map<string, Map<number, { why: string; source: "tag" | "read" }>> {
  const out = new Map<string, Map<number, { why: string; source: "tag" | "read" }>>();
  for (const id of new Set([...read.keys(), ...tagged.keys()])) {
    const tags = tagged.get(id) ?? [];
    const m = new Map<number, { why: string; source: "tag" | "read" }>();
    if (tags.length) for (const t of tags) m.set(t.reasonId, { why: `Tagged "${t.tag}" in Klaviyo`, source: "tag" });
    else for (const [rid, why] of read.get(id) ?? []) m.set(rid, { why, source: "read" });
    if (m.size) out.set(id, m);
  }
  return out;
}
