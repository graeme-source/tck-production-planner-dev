/**
 * Klaviyo campaigns → marketing-calendar emails: the pure mapping (tested).
 * The fetching and caching live in klaviyo-campaign-calendar.ts.
 */
export interface KlaviyoCalendarEmail {
  id: string;
  name: string;
  /** Drafts come too (2026-09-30), for linking and approvals. A draft's day
   *  is its planned send time, which Klaviyo defaults to when the draft was
   *  made — treat it as a placeholder. */
  status: "Draft" | "Scheduled" | "Sending" | "Sent";
  /** London calendar day it sends / sent. */
  date: string;
  /** Full timestamp (ISO, UTC). */
  sendAt: string;
  subject: string | null;
  previewText: string | null;
  /** More than one message = an A/B test; subject above is the first. */
  abTest: boolean;
  audiences: string[];
  excludedCount: number;
  klaviyoUrl: string;
}

export interface RawCampaign {
  id: string;
  attributes: {
    name: string;
    status: string;
    send_time: string | null;
    scheduled_at: string | null;
    send_strategy?: { method?: string; options_static?: { datetime?: string | null } | null } | null;
    updated_at?: string | null;
    audiences?: { included?: string[]; excluded?: string[] };
  };
  relationships?: { "campaign-messages"?: { data?: Array<{ id: string }> } };
}
export interface RawMessage { id: string; attributes: { content?: { subject?: string | null; preview_text?: string | null } } }

/**
 * Klaviyo's many campaign statuses → the four the calendar knows; null =
 * not shown (cancelled, unknown). Graeme, 2026-10-16: a scheduled email
 * Klaviyo called "Queued without Recipients" (scheduled, audience worked
 * out at send time) never showed or auto-linked, so its plan stayed linked
 * to the deleted clone it replaced.
 */
export function calendarStatus(raw: string): KlaviyoCalendarEmail["status"] | null {
  switch (raw) {
    case "Draft": return "Draft";
    case "Scheduled": case "Queued without Recipients": case "Preparing to schedule": return "Scheduled";
    case "Sending": case "Adding Recipients": case "Preparing to send": case "Sending Segments": return "Sending";
    case "Sent": case "Variations Sent": return "Sent";
    default: return null;
  }
}

export function londonDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

/** When a campaign sends (or, for a draft, is set to send). */
export function campaignSendAt(a: RawCampaign["attributes"]): string | null {
  if (a.status === "Draft") return a.send_strategy?.options_static?.datetime ?? null;
  return a.send_time ?? a.scheduled_at ?? null;
}

/** Sent campaigns open on their report; drafts in the editor; scheduled
 *  ones on the campaign list. Drafts are /wizard/1 — /edit is a Klaviyo 404
 *  (both paths checked against real campaigns by Graeme, 2026-10-09). */
export function klaviyoUrlFor(id: string, status: string): string {
  if (status === "Sent") return `https://www.klaviyo.com/campaign/${id}/reports/overview`;
  if (status === "Draft") return `https://www.klaviyo.com/campaign/${id}/wizard/1`;
  return "https://www.klaviyo.com/campaigns";
}

function firstMessage(c: RawCampaign, msgById: Map<string, RawMessage>) {
  const msgIds = c.relationships?.["campaign-messages"]?.data?.map(d => d.id) ?? [];
  return { msgIds, first: msgIds.map(id => msgById.get(id)).find(Boolean) };
}

/** Klaviyo's campaigns → calendar emails within [from, to] (London days).
 *  Drafts, scheduled, sending and sent; cancelled never. */
export function campaignsToCalendar(input: {
  campaigns: RawCampaign[];
  messages: RawMessage[];
  audienceNames: Map<string, string>;
  from: string;
  to: string;
}): KlaviyoCalendarEmail[] {
  const msgById = new Map(input.messages.map(m => [m.id, m]));
  const out: KlaviyoCalendarEmail[] = [];
  const seen = new Set<string>();
  for (const c of input.campaigns) {
    const a = c.attributes;
    const status = calendarStatus(a.status);
    if (!status || seen.has(c.id)) continue;
    const sendAt = campaignSendAt(a);
    if (!sendAt) continue;
    const date = londonDay(sendAt);
    if (date < input.from || date > input.to) continue;
    seen.add(c.id);
    const { msgIds, first } = firstMessage(c, msgById);
    const included = a.audiences?.included ?? [];
    out.push({
      id: c.id,
      name: a.name,
      status,
      date,
      sendAt,
      subject: first?.attributes.content?.subject?.trim() || null,
      previewText: first?.attributes.content?.preview_text?.trim() || null,
      abTest: msgIds.length > 1,
      audiences: included.map(id => input.audienceNames.get(id) ?? id),
      excludedCount: a.audiences?.excluded?.length ?? 0,
      klaviyoUrl: klaviyoUrlFor(c.id, status),
    });
  }
  return out.sort((x, y) => x.sendAt.localeCompare(y.sendAt));
}

/** A Klaviyo draft with no send date yet (2026-10-20): it can't sit on a
 *  day, so the calendar lists it under "Drafts without a date". */
export type KlaviyoUndatedDraft = Omit<KlaviyoCalendarEmail, "date" | "sendAt" | "status"> & {
  status: "Draft"; date: null; sendAt: null; updatedAt: string | null;
};

/** Drafts with no send date, edited on or after `since` (ISO), newest first.
 *  Older undated drafts are taken as abandoned and not shown. */
export function undatedDrafts(input: { campaigns: RawCampaign[]; messages: RawMessage[]; since: string }): KlaviyoUndatedDraft[] {
  const msgById = new Map(input.messages.map(m => [m.id, m]));
  const out: KlaviyoUndatedDraft[] = [];
  const seen = new Set<string>();
  for (const c of input.campaigns) {
    const a = c.attributes;
    if (a.status !== "Draft" || seen.has(c.id) || campaignSendAt(a)) continue;
    if ((a.updated_at ?? "") < input.since) continue;
    seen.add(c.id);
    const { msgIds, first } = firstMessage(c, msgById);
    out.push({
      id: c.id, name: a.name, status: "Draft", date: null, sendAt: null, updatedAt: a.updated_at ?? null,
      subject: first?.attributes.content?.subject?.trim() || null,
      previewText: first?.attributes.content?.preview_text?.trim() || null,
      abTest: msgIds.length > 1,
      audiences: [],
      excludedCount: a.audiences?.excluded?.length ?? 0,
      klaviyoUrl: klaviyoUrlFor(c.id, "Draft"),
    });
  }
  return out.sort((x, y) => (y.updatedAt ?? "").localeCompare(x.updatedAt ?? ""));
}

/** One campaign as the approval needs it (current subject line, preview
 *  text, send time and status), from GET /api/campaigns/{id}?include=campaign-messages. */
export function campaignSnapshot(c: RawCampaign, messages: RawMessage[]): {
  id: string; name: string; status: string; subject: string | null; previewText: string | null; sendAt: string | null; date: string | null;
} {
  const { first } = firstMessage(c, new Map(messages.map(m => [m.id, m])));
  const sendAt = campaignSendAt(c.attributes);
  return {
    id: c.id,
    name: c.attributes.name,
    status: calendarStatus(c.attributes.status) ?? c.attributes.status,
    subject: first?.attributes.content?.subject?.trim() || null,
    previewText: first?.attributes.content?.preview_text?.trim() || null,
    sendAt,
    date: sendAt ? londonDay(sendAt) : null,
  };
}

// ── Results per campaign (email list view, 2026-10-14) ──────────────────────
/** What the list view shows under a sent email. Rates are 0–1. */
export interface KlaviyoCampaignResult {
  campaignId: string;
  recipients: number;
  openRate: number;
  clickRate: number;
  /** People who opened / clicked / placed an order — the counts Klaviyo shows
   *  under each rate (Graeme, 2026-10-26). */
  opens: number;
  clicks: number;
  buyers: number;
  /** Placed-order rate: buyers ÷ recipients. */
  orderRate: number;
  /** Placed orders attributed to the email (Klaviyo's attribution). */
  orders: number;
  /** £ of those orders. */
  revenue: number;
}

/** One row of Klaviyo's campaign values report (grouped by message). */
export interface RawCampaignValuesRow {
  groupings?: { campaign_id?: string | null; campaign_message_id?: string | null; send_channel?: string | null };
  statistics?: Record<string, number | null | undefined>;
}

/**
 * Klaviyo's campaign values report → one result per campaign. An A/B test
 * comes back as one row per message: recipients, orders and revenue add up;
 * open and click rates are weighted by each message's recipients.
 */
export function campaignResultsFromReport(rows: readonly RawCampaignValuesRow[]): Map<string, KlaviyoCampaignResult> {
  const acc = new Map<string, { recipients: number; opens: number; clicks: number; orders: number; revenue: number; uOpens: number; uClicks: number; buyers: number; haveUniques: boolean }>();
  for (const r of rows) {
    const id = r.groupings?.campaign_id;
    if (!id) continue;
    if (r.groupings?.send_channel && r.groupings.send_channel !== "email") continue;
    const s = r.statistics ?? {};
    const n = (k: string) => { const v = s[k]; return typeof v === "number" && Number.isFinite(v) ? v : 0; };
    const recipients = n("recipients");
    const a = acc.get(id) ?? { recipients: 0, opens: 0, clicks: 0, orders: 0, revenue: 0, uOpens: 0, uClicks: 0, buyers: 0, haveUniques: false };
    a.recipients += recipients;
    a.opens += n("open_rate") * recipients;
    a.clicks += n("click_rate") * recipients;
    a.orders += n("conversions");
    a.revenue += n("conversion_value");
    // Klaviyo's own unique counts when the report has them; otherwise
    // worked back from the rates (older cached reports).
    if (typeof s["opens_unique"] === "number") a.haveUniques = true;
    a.uOpens += n("opens_unique");
    a.uClicks += n("clicks_unique");
    a.buyers += n("conversion_uniques");
    acc.set(id, a);
  }
  const out = new Map<string, KlaviyoCampaignResult>();
  for (const [campaignId, a] of acc) {
    out.set(campaignId, {
      campaignId,
      recipients: Math.round(a.recipients),
      openRate: a.recipients > 0 ? a.opens / a.recipients : 0,
      clickRate: a.recipients > 0 ? a.clicks / a.recipients : 0,
      orders: Math.round(a.orders),
      revenue: Math.round(a.revenue * 100) / 100,
      opens: Math.round(a.haveUniques ? a.uOpens : a.opens),
      clicks: Math.round(a.haveUniques ? a.uClicks : a.clicks),
      buyers: Math.round(a.haveUniques ? a.buyers : a.orders),
      orderRate: a.recipients > 0 ? (a.haveUniques ? a.buyers : a.orders) / a.recipients : 0,
    });
  }
  return out;
}
