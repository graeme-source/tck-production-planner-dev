/**
 * Keep trying when Shopify says "too many requests" (Graeme, 29 Oct 2026).
 *
 * #138515 was packed and scanned in full, but its Complete failed at 08:45
 * because Shopify answered 429 ("Exceeded 4 calls per second") to the one
 * read the fulfil step makes first — several screens were polling Shopify
 * at that moment — and every Shopify call gave up on the first 429. "If we
 * fulfil an item in an order, it does indeed get fulfilled."
 *
 * Every Shopify call now goes through here:
 *   • 429 → wait (Retry-After, else 1s, 2s, 4s… capped at 10s) and try
 *     again, for up to SHOPIFY_RETRY_BUDGET_MS (2 minutes). Always safe:
 *     a 429 means Shopify did nothing.
 *   • A 429 also pauses EVERY call in this process until the wait is over,
 *     so the screens polling at the same moment back off together instead
 *     of keeping the bucket full.
 *   • 5xx or a dropped connection → retried the same way, but only for
 *     reads: a write that hit a 500 may have happened, so it is never sent
 *     twice.
 */

export const SHOPIFY_RETRY_BUDGET_MS = 2 * 60 * 1000;
const MAX_WAIT_MS = 10_000;

export function retryWaitMs(attempt: number, retryAfter: string | null): number {
  const ra = parseFloat(retryAfter ?? "");
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, MAX_WAIT_MS);
  return Math.min(1000 * 2 ** Math.max(0, attempt - 1), MAX_WAIT_MS);
}

/** Should this outcome be tried again? `res` null = the connection failed. */
export function isRetryable(res: { status: number } | null, idempotent: boolean): boolean {
  if (res == null) return idempotent;
  if (res.status === 429) return true;
  return idempotent && res.status >= 500 && res.status < 600;
}

export interface RetryClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const realClock: RetryClock = {
  now: () => Date.now(),
  sleep: ms => new Promise(r => setTimeout(r, ms)),
};

/** Process-wide pause after a 429 — shared by every Shopify call. */
let pausedUntil = 0;
export function _resetShopifyPause(): void { pausedUntil = 0; }

/**
 * Run one Shopify HTTP request, retrying per the rules above. `send` makes
 * the request; the final Response (ok or not) is returned for the caller to
 * read, and a connection error is re-thrown once the budget is spent.
 */
export async function withShopifyRetry(
  label: string,
  idempotent: boolean,
  send: () => Promise<Response>,
  clock: RetryClock = realClock,
  budgetMs: number = SHOPIFY_RETRY_BUDGET_MS,
): Promise<Response> {
  const started = clock.now();
  for (let attempt = 1; ; attempt++) {
    const pause = pausedUntil - clock.now();
    if (pause > 0) await clock.sleep(pause);

    let res: Response | null = null;
    let error: unknown = null;
    try { res = await send(); } catch (err) { error = err; }

    if (res && res.ok) return res;
    if (!isRetryable(res, idempotent)) {
      if (res) return res;
      throw error;
    }
    const wait = retryWaitMs(attempt, res?.headers.get("Retry-After") ?? null);
    if (clock.now() - started + wait > budgetMs) {
      console.error(`[shopify] ${label}: still ${res ? res.status : "unreachable"} after ${attempt} tries over ${Math.round((clock.now() - started) / 1000)}s — giving up`);
      if (res) return res;
      throw error;
    }
    if (res?.status === 429) pausedUntil = Math.max(pausedUntil, clock.now() + wait);
    if (attempt === 1 || attempt % 5 === 0) {
      console.warn(`[shopify] ${label}: ${res ? res.status : "connection failed"} — retrying in ${wait}ms (try ${attempt})`);
    }
    await res?.text().catch(() => undefined);
    await clock.sleep(wait);
  }
}
