/**
 * Klaviyo email campaigns on the marketing calendar (Graeme, 2026-09-30:
 * "one place to see it all at once"). READ-ONLY — Klaviyo stays the master;
 * nothing here ever writes to it.
 *
 * One-off email campaigns that are Scheduled, Sending or Sent appear on the
 * day they send (London time) with their campaign name, subject line,
 * preview text and audience. Drafts and cancelled campaigns are left out.
 *
 * The mapping is pure and tested; the fetch + small caches sit below it.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

import {
  campaignsToCalendar, londonDay, type KlaviyoCalendarEmail, type RawCampaign, type RawMessage,
} from "./klaviyo-campaign-map";

export type { KlaviyoCalendarEmail };

// ── Fetching ──────────────────────────────────────────────────────────────
const REVISION = "2024-10-15";

async function kFetch<T>(apiKey: string, url: string): Promise<T> {
  const res = await fetch(url.startsWith("http") ? url : `https://a.klaviyo.com${url}`, {
    headers: { Authorization: `Klaviyo-API-Key ${apiKey}`, revision: REVISION, Accept: "application/vnd.api+json" },
  });
  if (!res.ok) throw new Error(`Klaviyo ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

export async function getKlaviyoKey(): Promise<string | null> {
  const rows = await db.execute<{ value: string }>(sql`SELECT value FROM founder_settings WHERE key = 'klaviyo_api_key' LIMIT 1`);
  return rows.rows[0]?.value ?? null;
}

// List/segment names hardly change — keep them an hour.
const nameCache = new Map<string, { name: string; at: number }>();
async function audienceName(apiKey: string, id: string): Promise<string> {
  const hit = nameCache.get(id);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.name;
  let name = id;
  for (const kind of ["lists", "segments"] as const) {
    try {
      const r = await kFetch<{ data: { attributes: { name: string } } }>(apiKey, `/api/${kind}/${id}`);
      name = r.data.attributes.name;
      break;
    } catch { /* not this kind — try the other */ }
  }
  nameCache.set(id, { name, at: Date.now() });
  return name;
}

// The campaigns list is shared by every viewer and every range for 3 minutes,
// so two people planning at once don't double the calls to Klaviyo.
let pageCache: { at: number; campaigns: RawCampaign[]; messages: RawMessage[]; oldest: string | null; complete: boolean } | null = null;
const MAX_PAGES = 5; // 100 per page, newest-scheduled first — ~500 campaigns back

async function loadCampaigns(apiKey: string, from: string) {
  const fresh = pageCache && Date.now() - pageCache.at < 180_000;
  // Reuse only if the cached pages already reach back to `from` (or reached
  // Klaviyo's very oldest campaign).
  if (fresh && pageCache && (pageCache.complete || (pageCache.oldest != null && pageCache.oldest <= from))) {
    return pageCache;
  }
  const filter = encodeURIComponent("equals(messages.channel,'email')");
  let url: string | null = `/api/campaigns?filter=${filter}&sort=-scheduled_at&include=campaign-messages`;
  const campaigns: RawCampaign[] = [];
  const messages: RawMessage[] = [];
  let oldest: string | null = null;
  let complete = false;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const r: { data: RawCampaign[]; included?: RawMessage[]; links?: { next?: string | null } } = await kFetch(apiKey, url);
    campaigns.push(...r.data);
    messages.push(...(r.included ?? []));
    const last = r.data[r.data.length - 1]?.attributes.scheduled_at;
    if (last) oldest = londonDay(last);
    const next = r.links?.next ?? null;
    if (!next) complete = true;
    // Stop once this page already reaches back before the range asked for.
    url = oldest && oldest < from ? null : next;
  }
  pageCache = { at: Date.now(), campaigns, messages, oldest, complete };
  return pageCache;
}

export async function klaviyoEmailsForRange(from: string, to: string): Promise<{ connected: boolean; emails: KlaviyoCalendarEmail[] }> {
  const apiKey = await getKlaviyoKey();
  if (!apiKey) return { connected: false, emails: [] };
  const { campaigns, messages } = await loadCampaigns(apiKey, from);
  // Names only for campaigns actually in the range being looked at.
  const inRange = campaignsToCalendar({ campaigns, messages, audienceNames: new Map(), from, to });
  const shownIds = new Set(inRange.map(e => e.id));
  const ids = new Set<string>();
  for (const c of campaigns) if (shownIds.has(c.id)) for (const id of c.attributes.audiences?.included ?? []) ids.add(id);
  const audienceNames = new Map<string, string>();
  await Promise.all([...ids].map(async id => audienceNames.set(id, await audienceName(apiKey, id))));
  return { connected: true, emails: campaignsToCalendar({ campaigns, messages, audienceNames, from, to }) };
}
