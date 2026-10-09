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

const SHOWN = new Set(["Draft", "Scheduled", "Sending", "Sent"]);

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
    if (!SHOWN.has(a.status) || seen.has(c.id)) continue;
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
      status: a.status as KlaviyoCalendarEmail["status"],
      date,
      sendAt,
      subject: first?.attributes.content?.subject?.trim() || null,
      previewText: first?.attributes.content?.preview_text?.trim() || null,
      abTest: msgIds.length > 1,
      audiences: included.map(id => input.audienceNames.get(id) ?? id),
      excludedCount: a.audiences?.excluded?.length ?? 0,
      klaviyoUrl: klaviyoUrlFor(c.id, a.status),
    });
  }
  return out.sort((x, y) => x.sendAt.localeCompare(y.sendAt));
}

/** One campaign as the approval needs it (current subject line and status),
 *  from GET /api/campaigns/{id}?include=campaign-messages. */
export function campaignSnapshot(c: RawCampaign, messages: RawMessage[]): {
  id: string; name: string; status: string; subject: string | null; date: string | null;
} {
  const { first } = firstMessage(c, new Map(messages.map(m => [m.id, m])));
  const sendAt = campaignSendAt(c.attributes);
  return {
    id: c.id,
    name: c.attributes.name,
    status: c.attributes.status,
    subject: first?.attributes.content?.subject?.trim() || null,
    date: sendAt ? londonDay(sendAt) : null,
  };
}
