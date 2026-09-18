/**
 * The decision-making half of the Meta ad-spend sync — every rule that can
 * be reasoned about without a network call, kept pure so it is unit-tested
 * (meta-ads-sync.test.ts). The plumbing that actually talks to Meta and
 * writes rows lives in meta-ads.ts.
 *
 * Four rules matter here, and all four are the kind that break silently:
 *
 *  1. TRAILING RE-FETCH. Meta's spend figures settle late — the number you
 *     read for yesterday at 6am is not the number you read for yesterday
 *     two days later. A sync that fetched each day once and never looked
 *     again would permanently under-report the most recent days, which is
 *     exactly the window the founder actually looks at. So every run
 *     re-fetches the trailing 48 hours whether or not those days already
 *     have rows.
 *
 *  2. HAND-ENTERED WINS. A figure Graeme typed is never overwritten. He may
 *     have typed it precisely because Meta was wrong.
 *
 *  3. IDEMPOTENCE. Re-running a sync over a day whose figure has not
 *     changed writes nothing at all, so updated_at stays honest about when
 *     the number last actually moved.
 *
 *  4. TIMEZONE. Meta buckets spend by the AD ACCOUNT's timezone, and the
 *     Numbers page buckets revenue by London. If those disagree, spend and
 *     revenue land on different days and the ROAS figure is quietly wrong.
 *     Day-level data cannot be re-bucketed after the fact, so the only
 *     honest response is to detect the mismatch and say so.
 */

/** The timezone the Numbers page counts its days in. Spend has to match it. */
export const REPORTING_TIMEZONE = "Europe/London";

/** How far back the very first sync reaches, in days (inclusive of today). */
export const DEFAULT_BACKFILL_DAYS = 90;

/** How many days back every run re-fetches regardless of what it already has. */
export const DEFAULT_TRAILING_DAYS = 2;

/** Meta's Graph API version. Pinned: an unpinned version changes under you. */
export const DEFAULT_GRAPH_VERSION = "v21.0";

// ── Configuration ──────────────────────────────────────────────────────────

export type MetaAdsConfig =
  | { connected: true; token: string; accountId: string; graphVersion: string }
  | { connected: false; reason: MetaNotConnectedReason };

export type MetaNotConnectedReason =
  | "no-credentials"
  | "no-token"
  | "no-account-id"
  | "bad-account-id";

/** Human sentence for each not-connected reason, for the UI and the logs. */
export function notConnectedMessage(reason: MetaNotConnectedReason): string {
  switch (reason) {
    case "no-credentials":
      return "Not connected to Meta yet — set META_ADS_TOKEN and META_AD_ACCOUNT_ID.";
    case "no-token":
      return "Not connected to Meta yet — META_AD_ACCOUNT_ID is set but META_ADS_TOKEN is missing.";
    case "no-account-id":
      return "Not connected to Meta yet — META_ADS_TOKEN is set but META_AD_ACCOUNT_ID is missing.";
    case "bad-account-id":
      return "META_AD_ACCOUNT_ID doesn't look like an ad account id (expected act_1234567890).";
  }
}

/**
 * Read the Meta credentials out of an environment.
 *
 * Takes the environment as an argument rather than reading process.env, so
 * every branch is testable. Absent credentials are a normal, expected state
 * — not an error — because the feature ships before the token exists.
 *
 * The account id is accepted with or without the `act_` prefix (Meta's own
 * UI shows it both ways) and always normalised to `act_<digits>`.
 */
export function readMetaAdsConfig(env: Record<string, string | undefined>): MetaAdsConfig {
  const token = (env["META_ADS_TOKEN"] ?? "").trim();
  const rawAccount = (env["META_AD_ACCOUNT_ID"] ?? "").trim();
  const graphVersion = (env["META_GRAPH_VERSION"] ?? "").trim() || DEFAULT_GRAPH_VERSION;

  if (!token && !rawAccount) return { connected: false, reason: "no-credentials" };
  if (!token) return { connected: false, reason: "no-token" };
  if (!rawAccount) return { connected: false, reason: "no-account-id" };

  const accountId = normaliseAccountId(rawAccount);
  if (!accountId) return { connected: false, reason: "bad-account-id" };

  return { connected: true, token, accountId, graphVersion };
}

/** `act_123` / `123` / ` ACT_123 ` → `act_123`; anything else → null. */
export function normaliseAccountId(raw: string): string | null {
  const trimmed = raw.trim();
  const digits = /^act_?(\d+)$/i.exec(trimmed) ?? /^(\d+)$/.exec(trimmed);
  if (!digits?.[1]) return null;
  return `act_${digits[1]}`;
}

// ── The date window ────────────────────────────────────────────────────────

export interface SyncWindow {
  /** First day to fetch, YYYY-MM-DD, inclusive. */
  since: string;
  /** Last day to fetch, YYYY-MM-DD, inclusive. */
  until: string;
  /** Why the window starts where it does — surfaced in the sync log. */
  reason: "first-run-backfill" | "trailing-refetch" | "catch-up" | "backfill-floor";
}

export interface SyncWindowOptions {
  /** Today's date in the reporting timezone, YYYY-MM-DD. */
  today: string;
  /** The most recent day already written by a sync, or null if never run. */
  lastSyncedDate: string | null;
  backfillDays?: number;
  trailingDays?: number;
}

/**
 * Work out which days to ask Meta for.
 *
 * `until` is always today. Today's figure is necessarily partial — the day
 * is not over — but it is a real number, it is better than nothing, and the
 * trailing re-fetch replaces it tomorrow and the day after.
 *
 * `since` is the earliest of:
 *   - today minus `trailingDays` (rule 1: always re-read the unsettled tail)
 *   - `lastSyncedDate` minus `trailingDays`, when the sync has been down long
 *     enough that its own last day is older than that tail — otherwise the
 *     gap in the middle would never be filled
 * and is then clamped so a first run, or a long outage, can never ask for
 * more than `backfillDays` of history in one go.
 */
export function syncWindow(opts: SyncWindowOptions): SyncWindow {
  const { today, lastSyncedDate } = opts;
  const backfillDays = opts.backfillDays ?? DEFAULT_BACKFILL_DAYS;
  const trailingDays = opts.trailingDays ?? DEFAULT_TRAILING_DAYS;

  const until = today;
  const floor = addDays(today, -(backfillDays - 1));

  let since: string;
  let reason: SyncWindow["reason"];

  if (!lastSyncedDate) {
    since = floor;
    reason = "first-run-backfill";
  } else {
    const trailingStart = addDays(today, -trailingDays);
    if (lastSyncedDate >= trailingStart) {
      // Up to date: the trailing tail is the whole job.
      since = trailingStart;
      reason = "trailing-refetch";
    } else {
      // Behind. Start a trailing window back from the last day we DID write,
      // not from it — that day's figure was itself unsettled when we read it.
      since = addDays(lastSyncedDate, -trailingDays);
      reason = "catch-up";
    }
    if (since < floor) {
      since = floor;
      reason = "backfill-floor";
    }
  }

  // A clock skew or a future lastSyncedDate must never produce since > until.
  if (since > until) since = until;

  return { since, until, reason };
}

/** Add (or subtract) whole days to a YYYY-MM-DD string, calendar-correctly. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Not a date: ${date}`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Mapping Meta's rows ────────────────────────────────────────────────────

/** One row of Meta's insights response at level=account, time_increment=1. */
export interface MetaInsightRow {
  date_start?: unknown;
  date_stop?: unknown;
  spend?: unknown;
}

export interface DailySpend {
  /** YYYY-MM-DD, in the ad account's timezone. */
  date: string;
  /** Pounds (or whatever the account's currency is), to 2dp. */
  amount: number;
}

export interface MappedInsights {
  rows: DailySpend[];
  /** Rows thrown away, and why — logged so a silent drop is never invisible. */
  discarded: Array<{ row: unknown; reason: string }>;
}

/**
 * Turn Meta's insight rows into one amount per day, inside the window.
 *
 * Meta sends `spend` as a decimal STRING ("42.17"), which is why this does
 * not trust typeof. Anything unparseable is discarded and reported rather
 * than silently becoming 0 — a zero would read as "we spent nothing that
 * day", which is a different and much worse claim than "we don't know".
 *
 * Days are summed rather than last-one-wins. At level=account with
 * time_increment=1 there should be exactly one row per day, so the sum
 * equals that row; if Meta ever splits a day, adding is the answer that
 * stays correct.
 */
export function mapInsightRows(
  raw: unknown,
  window: { since: string; until: string },
): MappedInsights {
  const discarded: Array<{ row: unknown; reason: string }> = [];
  if (!Array.isArray(raw)) {
    return { rows: [], discarded: raw == null ? [] : [{ row: raw, reason: "response was not a list" }] };
  }

  const byDate = new Map<string, number>();
  for (const row of raw as MetaInsightRow[]) {
    if (row == null || typeof row !== "object") {
      discarded.push({ row, reason: "not an object" });
      continue;
    }
    const date = typeof row.date_start === "string" ? row.date_start.slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      discarded.push({ row, reason: "no usable date_start" });
      continue;
    }
    if (date < window.since || date > window.until) {
      discarded.push({ row, reason: `outside the requested window (${date})` });
      continue;
    }
    const amount = parseSpend(row.spend);
    if (amount === null) {
      discarded.push({ row, reason: `unreadable spend (${String(row.spend)})` });
      continue;
    }
    byDate.set(date, (byDate.get(date) ?? 0) + amount);
  }

  const rows = [...byDate.entries()]
    .map(([date, amount]) => ({ date, amount: round2(amount) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return { rows, discarded };
}

/** Meta sends money as a decimal string. Negative or non-finite → null. */
export function parseSpend(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? round2(value) : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return round2(n);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── The merge rule ─────────────────────────────────────────────────────────

export type SpendSource = "manual" | "meta";

export interface ExistingSpendRow {
  source: string;
  amount: number;
}

export type MergeVerdict =
  | { action: "insert"; reason: "no row for this day yet" }
  | { action: "update"; reason: "the synced figure has changed" }
  | { action: "skip"; reason: "hand-entered — a person's figure always wins" }
  | { action: "skip"; reason: "unchanged since the last sync" };

/**
 * Decide what a sync may do to one day.
 *
 * This is the rule the whole feature turns on. 'manual' rows are untouchable
 * — including a row a person typed over a previously synced figure, which is
 * how a day gets pinned. Equal figures are skipped so re-running a sync
 * changes nothing at all.
 */
export function mergeVerdict(
  existing: ExistingSpendRow | null | undefined,
  incomingAmount: number,
): MergeVerdict {
  if (!existing) return { action: "insert", reason: "no row for this day yet" };
  if (existing.source !== "meta") {
    return { action: "skip", reason: "hand-entered — a person's figure always wins" };
  }
  if (round2(existing.amount) === round2(incomingAmount)) {
    return { action: "skip", reason: "unchanged since the last sync" };
  }
  return { action: "update", reason: "the synced figure has changed" };
}

export interface MergePlan {
  inserts: DailySpend[];
  updates: DailySpend[];
  skippedManual: string[];
  unchanged: string[];
}

/** Apply mergeVerdict across a whole window's worth of days. */
export function planMerge(
  incoming: DailySpend[],
  existingByDate: Map<string, ExistingSpendRow>,
): MergePlan {
  const plan: MergePlan = { inserts: [], updates: [], skippedManual: [], unchanged: [] };
  for (const row of incoming) {
    const verdict = mergeVerdict(existingByDate.get(row.date), row.amount);
    if (verdict.action === "insert") plan.inserts.push(row);
    else if (verdict.action === "update") plan.updates.push(row);
    else if (verdict.reason === "unchanged since the last sync") plan.unchanged.push(row.date);
    else plan.skippedManual.push(row.date);
  }
  return plan;
}

// ── Timezone alignment ─────────────────────────────────────────────────────

export interface TimezoneCheck {
  aligned: boolean;
  accountTimezone: string | null;
  expected: string;
  /** Null when aligned; a sentence to show the founder when not. */
  warning: string | null;
}

/**
 * Compare the ad account's reporting timezone with the one the Numbers page
 * counts revenue in.
 *
 * There is no code fix for a mismatch. Meta returns day TOTALS, so once
 * spend has been bucketed into the wrong days it cannot be re-cut into
 * London days from this end — the fix is to change the ad account's
 * timezone in Meta (which Meta only allows on an account with no spend) or
 * to accept the skew knowingly. So this reports rather than corrects.
 */
export function checkTimezoneAlignment(
  accountTimezone: string | null | undefined,
  expected: string = REPORTING_TIMEZONE,
): TimezoneCheck {
  const tz = typeof accountTimezone === "string" && accountTimezone.trim() !== ""
    ? accountTimezone.trim()
    : null;
  if (tz === null) {
    return {
      aligned: false,
      accountTimezone: null,
      expected,
      warning: `Meta didn't report the ad account's timezone, so we can't confirm its days line up with ${expected}.`,
    };
  }
  if (tz === expected) return { aligned: true, accountTimezone: tz, expected, warning: null };
  return {
    aligned: false,
    accountTimezone: tz,
    expected,
    warning:
      `Meta reports this ad account in ${tz}, but the Numbers page counts days in ${expected}. ` +
      `Spend and revenue will land on slightly different days, so ROAS will be a little off. ` +
      `Fix it by setting the ad account's timezone in Meta Ads Manager.`,
  };
}
