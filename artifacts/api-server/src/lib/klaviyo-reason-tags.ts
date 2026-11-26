/**
 * Klaviyo campaign tags that name a reason to buy (Graeme, 26 Nov 2026: the
 * team now tags each campaign with the reason it uses, "pretty much
 * character for character"). Lists the account's tags, keeps the ones whose
 * name is a reason's (reasonForTag — the rest are ignored), and asks Klaviyo
 * which campaigns carry each. Kept for 10 minutes. READ-ONLY towards Klaviyo.
 * Fails quietly: no tags just means every email is read as before.
 */
import { reasonForTag, type ReasonDef } from "@workspace/marketing-calendar";
import { getKlaviyoKey, kFetch } from "./klaviyo-campaign-calendar";

const TTL_MS = 10 * 60_000;
const MAX_PAGES = 20;
let cache: { at: number; key: string; map: Map<string, Array<{ reasonId: number; tag: string }>> } | null = null;

type Page<T> = { data?: T[]; links?: { next?: string | null } };

/** campaignId → the reason tags on it. */
export async function reasonTagsByCampaign(reasons: readonly ReasonDef[]): Promise<Map<string, Array<{ reasonId: number; tag: string }>>> {
  const signature = reasons.map((r) => `${r.id}:${r.name}`).join("|");
  if (cache && cache.key === signature && Date.now() - cache.at < TTL_MS) return cache.map;
  const map = new Map<string, Array<{ reasonId: number; tag: string }>>();
  try {
    const apiKey = await getKlaviyoKey();
    if (!apiKey || reasons.length === 0) return map;
    const tags: Array<{ id: string; name: string }> = [];
    let url: string | null = "/api/tags?page[size]=50";
    for (let p = 0; url && p < MAX_PAGES; p++) {
      const r: Page<{ id: string; attributes?: { name?: string } }> = await kFetch(apiKey, url);
      for (const t of r.data ?? []) if (t.attributes?.name) tags.push({ id: t.id, name: t.attributes.name });
      url = r.links?.next ?? null;
    }
    for (const t of tags) {
      const reason = reasonForTag(t.name, reasons);
      if (!reason) continue;
      let next: string | null = `/api/tags/${t.id}/relationships/campaigns`;
      for (let p = 0; next && p < MAX_PAGES; p++) {
        const r: Page<{ id: string }> = await kFetch(apiKey, next);
        for (const c of r.data ?? []) {
          const list = map.get(c.id) ?? [];
          if (!list.some((x) => x.reasonId === reason.id)) list.push({ reasonId: reason.id, tag: t.name });
          map.set(c.id, list);
        }
        next = r.links?.next ?? null;
      }
    }
    cache = { at: Date.now(), key: signature, map };
  } catch (err) {
    console.warn("[reasons-to-buy] Klaviyo tags unavailable, reading emails only:", err instanceof Error ? err.message : err);
    if (cache && cache.key === signature) return cache.map;
  }
  return map;
}
