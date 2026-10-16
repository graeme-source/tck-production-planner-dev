/**
 * Data for the factory-number forecast on Create / Edit Plan (Graeme,
 * 15 Oct 2026). Objective C. The maths is pure and tested in
 * @workspace/stock-prediction (late-orders.ts, factory-forecast.ts); this
 * file only gathers its inputs:
 *
 *   orders   calzone 2-packs per Shopify order from shopify_orders_cache
 *            (READ ONLY), last 28 weeks — a line counts when its variant is
 *            linked to a recipe on the calzone line (kitchenLine), so mac
 *            cheese and fried chicken stay out. Cached for 15 minutes; the
 *            curve is re-fitted from it on every request, so it always
 *            reflects the latest 26 weeks with no scheduled job.
 *   emails   Klaviyo email campaigns (sent → the usual rate; scheduled →
 *            due before a cut-off) plus planned rows on the email plan
 *            (marketing_emails) not yet scheduled in Klaviyo.
 *   settings the six levels in app_settings (factory_forecast_*) and the
 *            fewest batches a day (factory_min_batches_per_day).
 */
import { db, appSettingsTable } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";
import { kitchenLine } from "@workspace/production-schedule";
import {
  FACTORY_FORECAST_SETTING_KEYS, FALLBACK_EMAILS_PER_DAY, parseFactoryThresholds, londonWallTimeMs,
  type FactoryThresholds, type ForecastOrder,
} from "@workspace/stock-prediction";
import { klaviyoCampaignsForMatching } from "./klaviyo-campaign-calendar";
import { londonDateString } from "./london-time";

const HISTORY_WEEKS = 28;
const CACHE_MS = 15 * 60_000;

export interface RecipeLine { recipeId: number; packs: number; createdAt: number; cancelledAt: number | null }

let ordersCache: { at: number; orders: ForecastOrder[]; lines: RecipeLine[] } | null = null;
let ordersLoading: Promise<{ orders: ForecastOrder[]; lines: RecipeLine[] }> | null = null;

async function loadOrdersFresh(): Promise<{ orders: ForecastOrder[]; lines: RecipeLine[] }> {
  const res = await db.execute<{
    order_id: string; created: string; cancelled: string | null; tags: string | null;
    recipe_id: number; category: string | null; default_storage: string | null; qty: number;
  }>(sql`
    SELECT o.id::text AS order_id,
           o.payload->>'created_at' AS created,
           o.payload->>'cancelled_at' AS cancelled,
           o.payload->>'tags' AS tags,
           m.recipe_id, r.category, r.default_storage,
           SUM((li->>'quantity')::int)::int AS qty
      FROM shopify_orders_cache o
      CROSS JOIN LATERAL jsonb_array_elements(o.payload->'line_items') li
      JOIN recipe_shopify_mappings m ON m.shopify_variant_id = li->>'variant_id'
      JOIN recipes r ON r.id = m.recipe_id
     WHERE o.created_at > now() - make_interval(weeks => ${HISTORY_WEEKS})
     GROUP BY 1, 2, 3, 4, 5, 6, 7
  `);
  const byOrder = new Map<string, ForecastOrder>();
  const lines: RecipeLine[] = [];
  for (const r of res.rows) {
    if (kitchenLine(r.category) !== "calzone") continue;
    // Wrapped into the freezer (recipe route, migration 0202 — buns): not
    // production-fridge stock, so not factory-number demand.
    if (r.default_storage === "freezer") continue;
    const deliveryDate = /\d{4}-\d{2}-\d{2}/.exec(r.tags ?? "")?.[0];
    const createdAt = Date.parse(r.created);
    if (!deliveryDate || !Number.isFinite(createdAt)) continue;
    const cancelledAt = r.cancelled ? Date.parse(r.cancelled) : null;
    const packs = Number(r.qty) || 0;
    if (packs <= 0) continue;
    lines.push({ recipeId: Number(r.recipe_id), packs, createdAt, cancelledAt });
    const o = byOrder.get(r.order_id);
    if (o) o.packs += packs;
    else byOrder.set(r.order_id, { createdAt, cancelledAt, deliveryDate, packs });
  }
  return { orders: [...byOrder.values()], lines };
}

export async function loadForecastOrders(): Promise<{ orders: ForecastOrder[]; lines: RecipeLine[] }> {
  if (ordersCache && Date.now() - ordersCache.at < CACHE_MS) return ordersCache;
  ordersLoading ??= loadOrdersFresh()
    .then(r => { ordersCache = { at: Date.now(), ...r }; return r; })
    .finally(() => { ordersLoading = null; });
  return ordersLoading;
}

export interface WindowEmail { at: number; name: string; source: "klaviyo" | "plan" }

/**
 * Emails due from `now` to `until`, and the usual rate per hour over the
 * curve's 26 weeks. Klaviyo unreachable → planned rows only and the measured
 * fallback rate; never throws (the forecast still shows, without emails).
 */
export async function loadEmailWindow(now: number, until: number): Promise<{
  emails: WindowEmail[]; typicalPerHour: number; klaviyoConnected: boolean;
}> {
  const sinceMs = now - 26 * 7 * 86_400_000;
  const since = londonDateString(new Date(sinceMs));
  let typicalPerHour = FALLBACK_EMAILS_PER_DAY / 24;
  let klaviyoConnected = false;
  const emails: WindowEmail[] = [];
  const klaviyoIds = new Set<string>();
  try {
    const all = await klaviyoCampaignsForMatching(since);
    if (all) {
      klaviyoConnected = true;
      let sent = 0;
      for (const e of all) {
        if (e.status === "Draft") continue;
        const at = Date.parse(e.sendAt);
        if (!Number.isFinite(at)) continue;
        klaviyoIds.add(e.id);
        if (at > sinceMs && at <= now && e.status === "Sent") sent++;
        if (at > now && at <= until) emails.push({ at, name: e.name, source: "klaviyo" });
      }
      typicalPerHour = sent / (26 * 7 * 24);
    }
  } catch (err) {
    console.warn("[factory-forecast] Klaviyo emails unavailable:", err instanceof Error ? err.message : err);
  }
  // Planned on the email plan but not (yet) a scheduled Klaviyo campaign.
  const fromDay = londonDateString(new Date(now));
  const toDay = londonDateString(new Date(until));
  const planned = await db.execute<{ send_date: string; send_time: string | null; subject: string; klaviyo_campaign_id: string | null }>(sql`
    SELECT to_char(send_date, 'YYYY-MM-DD') AS send_date, send_time, subject, klaviyo_campaign_id
      FROM marketing_emails
     WHERE deleted_at IS NULL AND skipped = false AND status <> 'sent'
       AND send_date BETWEEN ${fromDay}::date AND ${toDay}::date
  `);
  for (const p of planned.rows) {
    if (p.klaviyo_campaign_id && klaviyoIds.has(p.klaviyo_campaign_id)) continue;
    const at = londonWallTimeMs(p.send_date, p.send_time ?? "10:00");
    if (at > now && at <= until) emails.push({ at, name: p.subject, source: "plan" });
  }
  emails.sort((a, b) => a.at - b.at);
  return { emails, typicalPerHour, klaviyoConnected };
}

export async function loadFactoryThresholds(): Promise<FactoryThresholds> {
  const keys = FACTORY_FORECAST_SETTING_KEYS;
  const rows = await db
    .select({ key: appSettingsTable.key, value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, Object.values(keys)));
  const map = new Map(rows.map(r => [r.key, r.value]));
  return parseFactoryThresholds({
    targetLow: map.get(keys.targetLow), targetHigh: map.get(keys.targetHigh), warnAt: map.get(keys.warnAt),
    maxAt: map.get(keys.maxAt), lowAmber: map.get(keys.lowAmber), lowRed: map.get(keys.lowRed),
    minBatchesPerDay: map.get(keys.minBatchesPerDay),
  });
}

export async function saveFactoryThresholds(t: Partial<FactoryThresholds>): Promise<void> {
  for (const k of Object.keys(FACTORY_FORECAST_SETTING_KEYS) as Array<keyof FactoryThresholds>) {
    if (t[k] == null) continue;
    const key = FACTORY_FORECAST_SETTING_KEYS[k];
    const value = String(t[k]);
    await db.insert(appSettingsTable).values({ key, value })
      .onConflictDoUpdate({ target: appSettingsTable.key, set: { value, updatedAt: new Date() } });
  }
}
