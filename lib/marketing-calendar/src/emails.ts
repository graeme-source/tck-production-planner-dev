/**
 * Planned emails on the marketing calendar (Graeme, 2026-09-30) — the pure
 * rules, shared by the server and the page (tested in emails.test.ts).
 *
 * "Campaigns are basically periods of emails": a campaign is an existing
 * calendar event (a dated period with a name, offer and summary). An email
 * belongs to a campaign automatically, by its send day — nothing is stored,
 * so moving the email's date into the next campaign's window re-files it.
 */
import { daysBetween } from "./calendar";
import { diffFields, joinWithAnd, type FieldChange, type FieldValue } from "./history";

export interface CampaignWindow { id: number; startDate: string; endDate: string }

/**
 * The campaign an email sent on `date` belongs to, or null.
 *
 * THE RULE: of the campaigns whose dates contain the day, the one that
 * STARTED MOST RECENTLY wins (a "Super Black Friday" that starts inside
 * "Black Friday week" takes the emails from its first day). On the same
 * start day the SHORTER one wins (the more specific window); still tied,
 * the newer campaign (higher id).
 */
export function campaignForDate<T extends CampaignWindow>(date: string, campaigns: readonly T[]): T | null {
  let best: T | null = null;
  for (const c of campaigns) {
    if (c.startDate > date || c.endDate < date) continue;
    if (!best) { best = c; continue; }
    if (c.startDate !== best.startDate) { if (c.startDate > best.startDate) best = c; continue; }
    const lenC = daysBetween(c.startDate, c.endDate);
    const lenB = daysBetween(best.startDate, best.endDate);
    if (lenC !== lenB) { if (lenC < lenB) best = c; continue; }
    if (c.id > best.id) best = c;
  }
  return best;
}

/** Where "Add email" in a campaign's section starts: today when the campaign
 *  is running, otherwise its first day. */
export function defaultEmailDate(campaign: { startDate: string; endDate: string }, today: string): string {
  return today >= campaign.startDate && today <= campaign.endDate ? today : campaign.startDate;
}

// ── The list view: campaign sections with planned + Klaviyo emails ─────────

export interface PlannedLike { id: number; sendDate: string; sendTime: string | null; klaviyoCampaignId: string | null }
export interface KlaviyoLike { id: string; date: string; sendAt: string }

export type SectionItem<P, K> =
  | { kind: "planned"; date: string; planned: P; klaviyo: K | null }
  | { kind: "klaviyo"; date: string; klaviyo: K };

export interface EmailSection<C, P, K> {
  key: string;
  /** null = "Not in a campaign". */
  campaign: C | null;
  items: Array<SectionItem<P, K>>;
}

function londonHm(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false });
}

function timeKey<P extends PlannedLike, K extends KlaviyoLike>(it: SectionItem<P, K>): string {
  if (it.kind === "planned") return it.planned.sendTime ?? (it.klaviyo ? londonHm(it.klaviyo.sendAt) : "99:99");
  return londonHm(it.klaviyo.sendAt);
}

/**
 * The List view, top to bottom in date order. Every shown campaign gets a
 * section (even an empty one, so emails can be added to it), placed at its
 * start day; emails outside every campaign gather into "Not in a campaign"
 * sections between them. A planned email linked to a Klaviyo send carries
 * that send with it, and the send is not listed a second time.
 * Past emails and campaigns that have ended are hidden unless `showPast`.
 */
export function buildEmailSections<C extends CampaignWindow, P extends PlannedLike, K extends KlaviyoLike>(input: {
  campaigns: readonly C[];
  planned: readonly P[];
  klaviyo: readonly K[];
  today: string;
  showPast: boolean;
}): Array<EmailSection<C, P, K>> {
  const { campaigns, planned, klaviyo, today, showPast } = input;
  const klaviyoById = new Map(klaviyo.map(k => [k.id, k]));
  const linked = new Set(planned.map(p => p.klaviyoCampaignId).filter((x): x is string => !!x));

  let items: Array<SectionItem<P, K>> = [
    ...planned.map(p => ({
      kind: "planned" as const, date: p.sendDate, planned: p,
      klaviyo: p.klaviyoCampaignId ? klaviyoById.get(p.klaviyoCampaignId) ?? null : null,
    })),
    ...klaviyo.filter(k => !linked.has(k.id)).map(k => ({ kind: "klaviyo" as const, date: k.date, klaviyo: k })),
  ];
  if (!showPast) items = items.filter(it => it.date >= today);
  items.sort((a, b) => a.date.localeCompare(b.date) || timeKey(a).localeCompare(timeKey(b)));

  const byCampaign = new Map<number, Array<SectionItem<P, K>>>();
  const loose: Array<SectionItem<P, K>> = [];
  for (const it of items) {
    const c = campaignForDate(it.date, campaigns);
    if (!c) { loose.push(it); continue; }
    const list = byCampaign.get(c.id) ?? [];
    list.push(it);
    byCampaign.set(c.id, list);
  }

  type Block = { at: string; order: number; campaign: C | null; item?: SectionItem<P, K> };
  const blocks: Block[] = [];
  for (const c of campaigns) {
    if (!showPast && c.endDate < today && !byCampaign.has(c.id)) continue;
    // A running campaign sits at today, so it leads an upcoming-only list.
    const at = !showPast && c.startDate < today ? today : c.startDate;
    blocks.push({ at, order: 0, campaign: c });
  }
  for (const it of loose) blocks.push({ at: it.date, order: 1, campaign: null, item: it });
  blocks.sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order
    || (a.campaign && b.campaign ? a.campaign.startDate.localeCompare(b.campaign.startDate) || a.campaign.id - b.campaign.id : 0));

  const sections: Array<EmailSection<C, P, K>> = [];
  for (const b of blocks) {
    if (b.campaign) {
      sections.push({ key: `campaign-${b.campaign.id}`, campaign: b.campaign, items: byCampaign.get(b.campaign.id) ?? [] });
      continue;
    }
    const last = sections[sections.length - 1];
    if (last && last.campaign === null) last.items.push(b.item!);
    else sections.push({ key: `none-${b.at}`, campaign: null, items: [b.item!] });
  }
  return sections;
}

// ── History sentences for planned emails ────────────────────────────────────

export const EMAIL_STATUSES = ["idea", "planned", "scheduled", "sent"] as const;
export const EMAIL_AUDIENCES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "all", label: "All" },
  { key: "new", label: "New customers" },
  { key: "returning", label: "Returning customers" },
  { key: "vip", label: "VIP" },
  { key: "lapsed", label: "Lapsed" },
];
export const EMAIL_AUDIENCE_KEYS = ["all", "new", "returning", "vip", "lapsed"] as const;

export function audienceLabel(key: string): string {
  return EMAIL_AUDIENCES.find(a => a.key === key)?.label ?? key;
}

/** Labels for the editable fields of a planned email, as a person says them. */
export const EMAIL_FIELD_LABELS: Record<string, string> = {
  subject: "subject line",
  sendTime: "send time",
  offer: "offer",
  coreMessage: "core message",
  smsSuggestion: "SMS suggestion",
  cadence: "cadence",
  audiences: "audience",
  audienceOther: "specific list",
  websiteChange: "website change",
  metaChange: "Meta change",
  notes: "notes",
  status: "status",
};

export function diffEmailFields(before: Record<string, FieldValue>, patch: Record<string, FieldValue>): Record<string, FieldChange> {
  return diffFields(before, patch, EMAIL_FIELD_LABELS);
}

/** "changed the subject line to “Early access starts now”, set the audience
 *  to VIP and edited the core message". */
export function describeEmailFieldChanges(changes: Record<string, FieldChange>): string | null {
  const parts: string[] = [];
  for (const [key, { to }] of Object.entries(changes)) {
    const label = EMAIL_FIELD_LABELS[key] ?? key;
    const empty = to == null || to === "" || (Array.isArray(to) && to.length === 0);
    if (key === "audiences") {
      const list = Array.isArray(to) ? to : [];
      parts.push(list.length ? `set the audience to ${list.map(audienceLabel).join(", ")}` : "cleared the audience");
    } else if (empty) parts.push(`cleared the ${label}`);
    else if (key === "subject") parts.push(`changed the subject line to “${String(to)}”`);
    else if (key === "status") parts.push(`changed the status to ${String(to)}`);
    else if (key === "sendTime") parts.push(`set the send time to ${String(to)}`);
    else parts.push(`edited the ${label}`);
  }
  return parts.length ? joinWithAnd(parts) : null;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Fri 20 Nov". */
export function formatDay(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  const dow = (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;
  return `${DAYS[dow]} ${d} ${MONTHS[m - 1]}`;
}

/** "moved it from Fri 20 Nov to Tue 24 Nov — now in “Main Black Friday”". */
export function describeEmailMove(
  fromDate: string, toDate: string,
  fromCampaign: string | null, toCampaign: string | null,
): string | null {
  if (fromDate === toDate) return null;
  const base = `moved it from ${formatDay(fromDate)} to ${formatDay(toDate)}`;
  if (fromCampaign === toCampaign) return base;
  return toCampaign ? `${base} — now in “${toCampaign}”` : `${base} — now not in a campaign`;
}

/** Linking the plan to the real Klaviyo send, or undoing it. */
export function describeKlaviyoLink(before: string | null, after: string | null): { action: "linked" | "unlinked"; summary: string } | null {
  if ((before ?? null) === (after ?? null)) return null;
  if (after) return { action: "linked", summary: `linked it to the Klaviyo email “${after}”` };
  return { action: "unlinked", summary: `unlinked the Klaviyo email${before ? ` “${before}”` : ""}` };
}
