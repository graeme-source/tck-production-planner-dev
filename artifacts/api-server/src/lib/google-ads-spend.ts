/**
 * Google Ads daily spend without the Google Ads API (Graeme, 2026-10-11).
 * Objective I — the ROAS cards and Order Analysis need ALL ad spend.
 *
 * A Google Ads Script (GOOGLE_ADS_SCRIPT below, also docs/google-ads-script.js)
 * runs inside Graeme's Google Ads account on a schedule and POSTs the last
 * week's spend per day to /api/ad-spend/google-ads. No developer token, no
 * OAuth: the only credential is a per-install key the founder makes on the
 * Numbers page, shown once and stored here only as a sha256 hash.
 *
 * Everything that can be decided without the database is here, pure and
 * tested: the payload's shape, the key, which days are acceptable, and the
 * timezone check. The writing is routes/google-ads-ingest.ts; the merge rule
 * (a hand-typed figure always wins) is meta-ads-sync.ts's planMerge, shared.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { addDaysToDateString } from "./london-time";
import { REPORTING_TIMEZONE } from "./meta-ads-sync";

/** The value the script's rows carry in ad_spend_channel_days.source. */
export const GOOGLE_SCRIPT_SOURCE = "google_ads_script";
export const GOOGLE_CHANNEL = "google";

/** Most days one POST may carry. The script sends 8; a backfill run 30. */
export const MAX_DAYS_PER_POST = 60;
/** How far back a day may be. Older than this is a typo, not a backfill. */
export const OLDEST_DAY_BACK = 400;

// ── The payload ────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day, not just the right shape (2026-02-30 is refused). */
export function isCalendarDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const GoogleAdsSpendPayload = z.object({
  /** The Google Ads customer id, e.g. "123-456-7890". Not a secret. */
  accountId: z.string().trim().regex(/^[0-9-]{6,20}$/, "accountId must be a Google Ads customer id like 123-456-7890"),
  /** The Numbers page counts pounds. Anything else is refused, never converted. */
  currency: z.literal("GBP", { errorMap: () => ({ message: "Only GBP accounts are accepted — the Numbers page counts pounds" }) }),
  /** The account's reporting timezone, as the script read it. */
  timeZone: z.string().trim().min(1).max(64).optional(),
  days: z.array(z.object({
    date: z.string().refine(isCalendarDate, "date must be a real day, YYYY-MM-DD"),
    /** Pounds. The script converts Google's micros and rounds to pence. */
    cost: z.number().finite().min(0).max(1_000_000),
  }).strict())
    .min(1, "days must not be empty")
    .max(MAX_DAYS_PER_POST, `${MAX_DAYS_PER_POST} days at most per send`)
    .refine(days => new Set(days.map(d => d.date)).size === days.length, "Each date may appear only once"),
}).strict();

export type GoogleAdsSpendPayload = z.infer<typeof GoogleAdsSpendPayload>;

/**
 * Days the planner will accept, relative to today in London. Tomorrow is
 * allowed (an account a few hours ahead of London is already there); later
 * than that, or more than OLDEST_DAY_BACK days ago, is refused whole —
 * one bad date means something is wrong with the script, so nothing saves.
 */
export function dayWindowProblem(dates: string[], todayLondon: string): string | null {
  const latest = addDaysToDateString(todayLondon, 1);
  const earliest = addDaysToDateString(todayLondon, -OLDEST_DAY_BACK);
  const future = dates.filter(d => d > latest);
  if (future.length > 0) return `Dates in the future aren't accepted: ${future.slice(0, 3).join(", ")}`;
  const ancient = dates.filter(d => d < earliest);
  if (ancient.length > 0) return `Dates more than ${OLDEST_DAY_BACK} days ago aren't accepted: ${ancient.slice(0, 3).join(", ")}`;
  return null;
}

/** The payload as rows for planMerge, oldest first, rounded to pence. */
export function payloadDays(p: GoogleAdsSpendPayload): Array<{ date: string; amount: number }> {
  return p.days
    .map(d => ({ date: d.date, amount: Math.round(d.cost * 100) / 100 }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ── The key ────────────────────────────────────────────────────────────────

const KEY_PREFIX = "tckga_";

/** A fresh key: 32 random bytes, URL-safe. Shown to the founder once. */
export function generateIngestKey(): string {
  return KEY_PREFIX + randomBytes(32).toString("base64url");
}

/**
 * What is stored: sha256 hex. The key is 256 bits of randomness, so a plain
 * hash is enough (no salt or slow hash needed — there is nothing to guess).
 */
export function hashIngestKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Last 4 characters, so the founder can tell an old key from a new one. */
export function keyHint(key: string): string {
  return key.slice(-4);
}

/**
 * Does the presented key match the stored hash? Constant time; a missing
 * key or a turned-off link (null hash) is always "no".
 */
export function verifyIngestKey(presented: string, storedHash: string | null | undefined): boolean {
  if (!presented || !storedHash || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  const a = Buffer.from(hashIngestKey(presented), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Timezone ───────────────────────────────────────────────────────────────

/**
 * Google Ads buckets spend by the ACCOUNT's timezone, which can only be set
 * when the account is created. The Numbers page counts London days. A
 * mismatch can't be fixed from here, so it is reported, not corrected.
 */
export function googleTimezoneWarning(timeZone: string | null | undefined): string | null {
  const tz = typeof timeZone === "string" ? timeZone.trim() : "";
  if (!tz) return null; // nothing received yet: nothing to say
  if (tz === REPORTING_TIMEZONE) return null;
  return `Your Google Ads account reports in ${tz}, but the Numbers page counts days in ${REPORTING_TIMEZONE}. ` +
    "Google's spend will land on slightly different days from the sales, so ROAS will be a little off. " +
    "Google only lets you choose the timezone when an account is created.";
}

// ── The script ─────────────────────────────────────────────────────────────

/** Placeholders the Numbers page fills before showing the script. */
export const SCRIPT_URL_PLACEHOLDER = "__APP_URL__";
export const SCRIPT_KEY_PLACEHOLDER = "__KEY__";

/**
 * The Google Ads Script. MUST match docs/google-ads-script.js exactly
 * (a test checks) — that file is the readable copy; this is the one the
 * app serves, because docs/ isn't in the deployed image.
 */
export const GOOGLE_ADS_SCRIPT = `// TCK Production Planner: send Google Ads daily spend to the Numbers page.
// Google Ads > Tools > Bulk actions > Scripts. Schedule it Daily (or Hourly).
var APP_URL = '__APP_URL__';
var KEY = '__KEY__';
var DAYS = 8; // today + the 7 days before. Set to 30 for ONE run to fill past days.

function main() {
  var account = AdsApp.currentAccount();
  var tz = account.getTimeZone();
  if (tz !== 'Europe/London') Logger.log('WARNING: this account reports in ' + tz + ', not Europe/London, so its days will not line up with the planner.');
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var cost = {};
  var dates = [];
  for (var i = DAYS - 1; i >= 0; i--) {
    var d = new Date(today + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - i);
    var day = d.toISOString().slice(0, 10);
    dates.push(day);
    cost[day] = 0; // a day with no spend comes back with no row: that is £0
  }
  var rows = AdsApp.search('SELECT segments.date, metrics.cost_micros FROM customer ' +
    "WHERE segments.date BETWEEN '" + dates[0] + "' AND '" + today + "'");
  while (rows.hasNext()) {
    var r = rows.next();
    cost[r.segments.date] += Number(r.metrics.costMicros) / 1000000;
  }
  var body = { accountId: account.getCustomerId(), currency: account.getCurrencyCode(), timeZone: tz,
    days: dates.map(function (day) { return { date: day, cost: Math.round(cost[day] * 100) / 100 }; }) };
  var res = UrlFetchApp.fetch(APP_URL, { method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + KEY }, payload: JSON.stringify(body), muteHttpExceptions: true });
  Logger.log(res.getResponseCode() + ' ' + res.getContentText());
  if (res.getResponseCode() !== 200) throw new Error('The planner did not accept the spend - see the log above.');
}
`;
