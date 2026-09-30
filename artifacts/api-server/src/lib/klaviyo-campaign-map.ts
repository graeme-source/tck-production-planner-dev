/**
 * Klaviyo campaigns → marketing-calendar emails: the pure mapping (tested).
 * The fetching and caching live in klaviyo-campaign-calendar.ts.
 */
export interface KlaviyoCalendarEmail {
  id: string;
  name: string;
  status: "Scheduled" | "Sending" | "Sent";
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
    audiences?: { included?: string[]; excluded?: string[] };
  };
  relationships?: { "campaign-messages"?: { data?: Array<{ id: string }> } };
}
export interface RawMessage { id: string; attributes: { content?: { subject?: string | null; preview_text?: string | null } } }

const SHOWN = new Set(["Scheduled", "Sending", "Sent"]);

export function londonDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

/** Klaviyo's campaigns page → calendar emails within [from, to] (London days). */
export function campaignsToCalendar(input: {
  campaigns: RawCampaign[];
  messages: RawMessage[];
  audienceNames: Map<string, string>;
  from: string;
  to: string;
}): KlaviyoCalendarEmail[] {
  const msgById = new Map(input.messages.map(m => [m.id, m]));
  const out: KlaviyoCalendarEmail[] = [];
  for (const c of input.campaigns) {
    const a = c.attributes;
    if (!SHOWN.has(a.status)) continue;
    const sendAt = a.send_time ?? a.scheduled_at;
    if (!sendAt) continue;
    const date = londonDay(sendAt);
    if (date < input.from || date > input.to) continue;
    const msgIds = c.relationships?.["campaign-messages"]?.data?.map(d => d.id) ?? [];
    const first = msgIds.map(id => msgById.get(id)).find(Boolean);
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
      // Sent campaigns open on their report; scheduled ones on the campaign list.
      klaviyoUrl: a.status === "Sent"
        ? `https://www.klaviyo.com/campaign/${c.id}/reports/overview`
        : "https://www.klaviyo.com/campaigns",
    });
  }
  return out.sort((x, y) => x.sendAt.localeCompare(y.sendAt));
}

