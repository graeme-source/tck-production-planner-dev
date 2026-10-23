/**
 * APC tracking — cached status + "is APC slow today?" (issue #339, pure).
 *
 * The packing-path safety check (incident #136845) asks APC's tracking
 * whether a same-day consignment was cancelled before reusing it. When APC
 * is slow every order waited 3.5 s and showed an amber "APC Warnings" box.
 * Now:
 *   - today's consignments are read in the BACKGROUND (after batch booking,
 *     and while the pick list is open) and the answer cached on the
 *     apc_consignments row; opening an order uses a recent cached answer
 *     instead of waiting on APC;
 *   - with no recent answer and APC still slow, the order is reused on the
 *     date rule as before, shown as one small grey line — the amber box is
 *     kept for real problems (cancelled, wrong day);
 *   - several slow checks in a row light one banner on the pack list.
 *
 * Database reads/writes live in apc-consignment-ledger.ts.
 */
import type { LiveStatus } from "./apc-consignment-reuse";

/** A cached answer younger than this is used instead of asking APC again.
 *  The background re-check keeps today's rows well inside it. */
export const TRACKING_CACHE_FRESH_MS = 30 * 60_000;

/** The background re-check reads rows whose answer is older than this. */
export const TRACKING_RECHECK_AFTER_MS = 10 * 60_000;

/** The cached columns of one apc_consignments row. */
export type CachedTrackingRow = {
  apc_status: string | null;
  apc_status_code: string | null;
  apc_dead_status: string | null;
  apc_status_checked_at: Date | string | null;
};

function checkedAtMs(at: Date | string | null): number | null {
  if (at == null) return null;
  const ms = new Date(at).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The cached tracking answer as a LiveStatus, or null when there is no
 * answer recent enough to trust (then the caller asks APC live).
 *   - dead status stored → dead (book a new one, same as a live answer)
 *   - a status stored → alive
 *   - checked but no status → APC had no tracking yet ("not-found")
 * A cached answer carries no APC collection date — the date rule already
 * judged our own collection date before this is consulted.
 */
export function cachedLiveStatus(row: CachedTrackingRow | null | undefined, nowMs: number, freshMs = TRACKING_CACHE_FRESH_MS): LiveStatus | null {
  if (!row) return null;
  const at = checkedAtMs(row.apc_status_checked_at);
  if (at == null || nowMs - at > freshMs || at - nowMs > 60_000) return null;
  if (row.apc_dead_status) {
    return {
      kind: "ok", dead: true,
      deadEvent: { at: null, dateTime: null, code: null, description: row.apc_dead_status },
      latest: null, collectionDate: null,
    };
  }
  if (row.apc_status || row.apc_status_code) {
    return {
      kind: "ok", dead: false, deadEvent: null,
      latest: { at: null, dateTime: null, code: row.apc_status_code, description: row.apc_status },
      collectionDate: null,
    };
  }
  return { kind: "not-found" };
}

/** Does this row need a background re-read? Dead is final; otherwise when
 *  never read or the answer is getting old. */
export function needsTrackingRecheck(row: CachedTrackingRow, nowMs: number, afterMs = TRACKING_RECHECK_AFTER_MS): boolean {
  if (row.apc_dead_status) return false;
  const at = checkedAtMs(row.apc_status_checked_at);
  return at == null || nowMs - at > afterMs;
}

/** The grey one-liner when APC couldn't be asked and the date rule alone
 *  was applied (replaces the amber "Couldn't check APC's tracking …"). */
export function trackingFallbackNotice(error: string): string {
  return /no answer|timeout|timed out|abort/i.test(error)
    ? "APC tracking slow — checked by date only"
    : "APC tracking unavailable — checked by date only";
}

// ── "APC is slow today" ────────────────────────────────────────────────

/** Slow checks in a row before the pack-list banner shows. */
export const SLOW_STREAK_THRESHOLD = 3;
/** The banner clears on its own when no slow check happened for this long. */
export const SLOW_BANNER_WINDOW_MS = 30 * 60_000;

export const SLOW_BANNER_TEXT = "APC tracking is slow today — bookings checked by date only";

export type TrackingHealth = {
  /** Unreachable / timed-out tracking reads since the last good one. */
  streak: number;
  lastSlowAt: number | null;
};

export const INITIAL_TRACKING_HEALTH: TrackingHealth = { streak: 0, lastSlowAt: null };

/** Fold one tracking read into the health record. Any answer from APC
 *  (status or "no tracking yet") ends the streak. */
export function recordTrackingOutcome(h: TrackingHealth, kind: LiveStatus["kind"], nowMs: number): TrackingHealth {
  if (kind === "unreachable") return { streak: h.streak + 1, lastSlowAt: nowMs };
  return INITIAL_TRACKING_HEALTH;
}

export function isTrackingSlow(h: TrackingHealth, nowMs: number): boolean {
  return h.streak >= SLOW_STREAK_THRESHOLD
    && h.lastSlowAt != null
    && nowMs - h.lastSlowAt <= SLOW_BANNER_WINDOW_MS;
}
