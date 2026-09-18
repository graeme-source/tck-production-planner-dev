/**
 * Meta Marketing API → founder_ad_spend.
 *
 * The plumbing: talk to Meta, write rows, remember what happened. Every
 * decision this file makes is delegated to meta-ads-sync.ts, which is pure
 * and unit-tested — keep it that way, so the only untestable part stays the
 * HTTP call itself.
 *
 * Shipped BEFORE the credentials existed, deliberately. With no token the
 * sync is a clean no-op and the Numbers panel says "Not connected to Meta
 * yet". It never invents a figure and never writes a zero: a zero on that
 * panel would read as "we spent nothing", which is a far worse claim than
 * "we don't know yet". The moment META_ADS_TOKEN and META_AD_ACCOUNT_ID
 * exist in Railway, this starts working with no code change.
 *
 * Reads only, as far as Meta is concerned — nothing here changes anything
 * in the ad account, so there is no side-effect kill switch to respect.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { londonDateString } from "./london-time";
import {
  readMetaAdsConfig,
  syncWindow,
  mapInsightRows,
  planMerge,
  checkTimezoneAlignment,
  notConnectedMessage,
  REPORTING_TIMEZONE,
  type MetaAdsConfig,
  type SyncWindow,
  type TimezoneCheck,
  type ExistingSpendRow,
  type DailySpend,
} from "./meta-ads-sync";

const GRAPH_HOST = "https://graph.facebook.com";
const LAST_SYNC_KEY = "meta_ads_last_sync";
const DAILY_MARKER_KEY = "meta_ads_last_daily_run";

/** Pages of insights to follow before giving up. 90 days at 500/page is one. */
const MAX_PAGES = 10;
const REQUEST_TIMEOUT_MS = 30_000;

export type SyncTrigger = "scheduled" | "manual" | "startup";

export interface MetaSyncResult {
  ok: boolean;
  connected: boolean;
  ranAt: string;
  trigger: SyncTrigger;
  window: SyncWindow | null;
  inserted: number;
  updated: number;
  /** Days left alone because a person had typed the figure. */
  skippedManual: number;
  unchanged: number;
  discarded: number;
  timezone: TimezoneCheck | null;
  currency: string | null;
  message: string;
  error: string | null;
}

// ── Talking to Meta ────────────────────────────────────────────────────────

/**
 * One Graph API GET.
 *
 * The token goes in the Authorization header, never the query string, so it
 * cannot end up in an access log or an error message. Error bodies are
 * truncated and scrubbed before they are allowed anywhere near a log line.
 */
async function graphGet(
  cfg: Extract<MetaAdsConfig, { connected: true }>,
  url: string,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/json" },
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Meta API ${res.status}: ${scrub(text, cfg.token).slice(0, 300)}`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Meta API returned a non-JSON body (${res.status})`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Belt and braces: never let a token reach a log, even via an echoed error. */
function scrub(text: string, token: string): string {
  return token ? text.split(token).join("[token]") : text;
}

/** The ad account's reporting timezone and currency. */
async function fetchAccountMeta(
  cfg: Extract<MetaAdsConfig, { connected: true }>,
): Promise<{ timezone: string | null; currency: string | null }> {
  const url = `${GRAPH_HOST}/${cfg.graphVersion}/${cfg.accountId}?fields=timezone_name,currency`;
  const body = (await graphGet(cfg, url)) as { timezone_name?: unknown; currency?: unknown };
  return {
    timezone: typeof body?.timezone_name === "string" ? body.timezone_name : null,
    currency: typeof body?.currency === "string" ? body.currency : null,
  };
}

/**
 * Daily spend for a window: level=account, time_increment=1, one row a day.
 * Follows Meta's cursor paging.
 */
async function fetchDailySpend(
  cfg: Extract<MetaAdsConfig, { connected: true }>,
  window: SyncWindow,
): Promise<unknown[]> {
  const params = new URLSearchParams({
    level: "account",
    time_increment: "1",
    fields: "spend",
    limit: "500",
    time_range: JSON.stringify({ since: window.since, until: window.until }),
  });
  let url: string | null = `${GRAPH_HOST}/${cfg.graphVersion}/${cfg.accountId}/insights?${params}`;

  const all: unknown[] = [];
  for (let page = 0; page < MAX_PAGES && url; page++) {
    const body = (await graphGet(cfg, url)) as {
      data?: unknown;
      paging?: { next?: unknown };
    };
    if (Array.isArray(body?.data)) all.push(...body.data);
    const next = body?.paging?.next;
    url = typeof next === "string" && next.startsWith(GRAPH_HOST) ? next : null;
  }
  return all;
}

// ── Reading and writing our side ───────────────────────────────────────────

/** False before the migrations have run on a cold database. */
async function adSpendTableReady(): Promise<boolean> {
  const guard = await db.execute<{ ok: string | null }>(sql`
    SELECT to_regclass('public.founder_ad_spend')::text AS ok
  `);
  if (!guard.rows[0]?.ok) return false;
  const col = await db.execute<{ n: string }>(sql`
    SELECT count(*)::text AS n FROM information_schema.columns
     WHERE table_name = 'founder_ad_spend' AND column_name = 'source'
  `);
  return Number(col.rows[0]?.n ?? 0) > 0;
}

/** The latest day a sync has written, or null if it has never run. */
async function lastSyncedDate(): Promise<string | null> {
  const rows = await db.execute<{ d: string | null }>(sql`
    SELECT MAX(spend_date)::text AS d FROM founder_ad_spend WHERE source = 'meta'
  `);
  return rows.rows[0]?.d ?? null;
}

async function existingRows(window: SyncWindow): Promise<Map<string, ExistingSpendRow>> {
  const rows = await db.execute<{ d: string; amount: string; source: string }>(sql`
    SELECT spend_date::text AS d, amount, source FROM founder_ad_spend
     WHERE spend_date BETWEEN ${window.since}::date AND ${window.until}::date
  `);
  const map = new Map<string, ExistingSpendRow>();
  for (const r of rows.rows) map.set(r.d, { source: r.source, amount: Number(r.amount) });
  return map;
}

/**
 * Write one synced day.
 *
 * The `WHERE founder_ad_spend.source = 'meta'` on the conflict clause is the
 * rule enforced by the database itself, not just by planMerge: if Graeme
 * types a figure while a sync is mid-flight, the update simply does not
 * apply. Hand-entered wins, even in a race.
 */
async function writeSyncedDay(row: DailySpend): Promise<void> {
  await db.execute(sql`
    INSERT INTO founder_ad_spend (spend_date, amount, updated_at, source, synced_at)
    VALUES (${row.date}::date, ${row.amount}, NOW(), 'meta', NOW())
    ON CONFLICT (spend_date) DO UPDATE
       SET amount = EXCLUDED.amount, updated_at = NOW(), synced_at = NOW()
     WHERE founder_ad_spend.source = 'meta'
  `);
}

async function setFounderSetting(key: string, value: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO founder_settings (key, value, updated_at) VALUES (${key}, ${value}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = NOW()
  `);
}

async function getFounderSetting(key: string): Promise<string | null> {
  const rows = await db.execute<{ value: string }>(
    sql`SELECT value FROM founder_settings WHERE key = ${key} LIMIT 1`,
  );
  return rows.rows[0]?.value ?? null;
}

// ── The sync ───────────────────────────────────────────────────────────────

function notConnectedResult(trigger: SyncTrigger, message: string): MetaSyncResult {
  return {
    ok: true, connected: false, ranAt: new Date().toISOString(), trigger,
    window: null, inserted: 0, updated: 0, skippedManual: 0, unchanged: 0, discarded: 0,
    timezone: null, currency: null, message, error: null,
  };
}

/**
 * Pull Meta's daily spend into founder_ad_spend.
 *
 * Never throws: a failure is a result with ok:false and a message, because
 * the caller is either a background timer (which must not crash the boot) or
 * a button (which wants something honest to show).
 */
export async function runMetaAdSpendSync(trigger: SyncTrigger = "manual"): Promise<MetaSyncResult> {
  const cfg = readMetaAdsConfig(process.env);
  if (!cfg.connected) {
    // Not an error. This is the expected state until the token is pasted in.
    return notConnectedResult(trigger, notConnectedMessage(cfg.reason));
  }

  const ranAt = new Date().toISOString();
  try {
    if (!(await adSpendTableReady())) {
      return {
        ...notConnectedResult(trigger, "Database isn't migrated for ad-spend sync yet."),
        connected: true, ok: false, ranAt,
      };
    }

    const window = syncWindow({
      today: londonDateString(),
      lastSyncedDate: await lastSyncedDate(),
    });

    const [{ timezone, currency }, raw] = await Promise.all([
      fetchAccountMeta(cfg),
      fetchDailySpend(cfg, window),
    ]);

    const tzCheck = checkTimezoneAlignment(timezone);
    const { rows, discarded } = mapInsightRows(raw, window);
    const plan = planMerge(rows, await existingRows(window));

    for (const row of [...plan.inserts, ...plan.updates]) await writeSyncedDay(row);

    const parts = [
      `${plan.inserts.length} added`,
      `${plan.updates.length} updated`,
      `${plan.unchanged.length} unchanged`,
    ];
    if (plan.skippedManual.length > 0) {
      parts.push(`${plan.skippedManual.length} left alone (typed in)`);
    }
    if (discarded.length > 0) {
      parts.push(`${discarded.length} unreadable`);
      console.warn("[meta-ads] discarded rows:", discarded.slice(0, 5).map(d => d.reason));
    }
    if (tzCheck.warning) console.warn(`[meta-ads] ${tzCheck.warning}`);

    const result: MetaSyncResult = {
      ok: true, connected: true, ranAt, trigger, window,
      inserted: plan.inserts.length,
      updated: plan.updates.length,
      skippedManual: plan.skippedManual.length,
      unchanged: plan.unchanged.length,
      discarded: discarded.length,
      timezone: tzCheck, currency,
      message: `${window.since} to ${window.until}: ${parts.join(", ")}.`,
      error: null,
    };
    await rememberLastSync(result);
    console.log(`[meta-ads] ${trigger} sync — ${result.message}`);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result: MetaSyncResult = {
      ok: false, connected: true, ranAt, trigger, window: null,
      inserted: 0, updated: 0, skippedManual: 0, unchanged: 0, discarded: 0,
      timezone: null, currency: null,
      message: "Couldn't reach Meta — yesterday's figure is unchanged.",
      error: message.slice(0, 500),
    };
    await rememberLastSync(result).catch(() => {});
    console.error("[meta-ads] sync failed:", message);
    return result;
  }
}

async function rememberLastSync(result: MetaSyncResult): Promise<void> {
  await setFounderSetting(LAST_SYNC_KEY, JSON.stringify(result));
}

export async function lastSyncRecord(): Promise<MetaSyncResult | null> {
  const raw = await getFounderSetting(LAST_SYNC_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MetaSyncResult;
  } catch {
    return null;
  }
}

// ── Status for the UI ──────────────────────────────────────────────────────

export interface MetaAdsStatus {
  connected: boolean;
  /** Present only when connected — the account id is not a secret. */
  accountId: string | null;
  /** Why we're not connected, in a sentence. Null when we are. */
  message: string | null;
  reportingTimezone: string;
  lastSync: MetaSyncResult | null;
}

export async function getMetaAdsStatus(): Promise<MetaAdsStatus> {
  const cfg = readMetaAdsConfig(process.env);
  return {
    connected: cfg.connected,
    accountId: cfg.connected ? cfg.accountId : null,
    message: cfg.connected ? null : notConnectedMessage(cfg.reason),
    reportingTimezone: REPORTING_TIMEZONE,
    lastSync: await lastSyncRecord().catch(() => null),
  };
}

// ── Schedule ───────────────────────────────────────────────────────────────

/** London hour the daily sync aims for — after Meta has settled overnight. */
const DAILY_HOUR = 6;
const TICK_MS = 60 * 60 * 1000;

/**
 * Daily sync, plus a run shortly after boot.
 *
 * Self-gating: with no credentials every tick is a no-op that costs one
 * env-var read, so this is safe to register before the token exists. An
 * hourly tick with a once-a-day marker means a restart at 6:05am doesn't
 * skip the day and a restart at 6:00pm doesn't run it twice.
 */
export function startMetaAdsScheduler(): void {
  const tick = async () => {
    const cfg = readMetaAdsConfig(process.env);
    if (!cfg.connected) return;
    const today = londonDateString();
    if (await getFounderSetting(DAILY_MARKER_KEY) === today) return;
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: REPORTING_TIMEZONE, hour: "2-digit", hourCycle: "h23",
      }).format(new Date()),
    );
    if (hour < DAILY_HOUR) return;
    await setFounderSetting(DAILY_MARKER_KEY, today);
    await runMetaAdSpendSync("scheduled");
  };

  const safeTick = () => void tick().catch(err =>
    console.warn("[meta-ads] scheduled sync failed (will retry next hour):", err));

  // A boot run catches up anything missed while the server was down, and is
  // how the very first sync happens the moment the token lands in Railway.
  setTimeout(() => {
    void runMetaAdSpendSync("startup").catch(() => {});
  }, 90_000).unref();
  setInterval(safeTick, TICK_MS).unref();
}
