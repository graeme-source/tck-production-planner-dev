// Shopify Payments payouts for the cash-flow forecast. READ-ONLY (queries only).
//
// Needs the app scopes read_shopify_payments_payouts (payouts) and
// read_shopify_payments_accounts (the account + unpaid balance). Without them
// Shopify answers ACCESS_DENIED; we report that in plain English rather than
// failing, so the forecast still renders without Shopify money.

import { shopifyGraphQL } from "../../services/shopify";
import { payoutsFromGraphQL, type ShopifyPayout } from "./shopify-payouts-map";

export type { ShopifyPayout } from "./shopify-payouts-map";

export interface ShopifyPayoutsResult {
  available: boolean;
  reason?: string;
  payouts: ShopifyPayout[];
  balance: number | null;
  currency: string | null;
  fetchedAt: string | null;
  error?: string;
}

const CACHE_MS = 10 * 60 * 1000;

// Newest 60 covers upcoming scheduled payouts plus roughly two months paid.
const QUERY = `query CashflowPayouts {
  shopifyPaymentsAccount {
    defaultCurrency
    balance { amount currencyCode }
    payouts(first: 60, reverse: true) {
      nodes { id issuedAt status transactionType net { amount currencyCode } }
    }
  }
}`;

export const SCOPE_REASON =
  "Shopify hasn't given the planner permission to read payouts. In the Shopify app settings, add the access scopes " +
  "read_shopify_payments_payouts and read_shopify_payments_accounts, then reinstall/approve the app.";

let last: ShopifyPayoutsResult | null = null;
let lastAt = 0;
let inflight: Promise<ShopifyPayoutsResult> | null = null;

function isScopeError(msg: string): boolean {
  return /access[_ ]denied|required access|access scope|required scope/i.test(msg);
}

async function fetchFresh(): Promise<ShopifyPayoutsResult> {
  const fetchedAt = new Date().toISOString();
  try {
    const data = await shopifyGraphQL<unknown>(QUERY);
    const account = (data as { shopifyPaymentsAccount?: unknown } | null)?.shopifyPaymentsAccount;
    if (!account) {
      return { available: false, reason: "This shop has no Shopify Payments account, so there are no payouts to show.", payouts: [], balance: null, currency: null, fetchedAt };
    }
    return { available: true, ...payoutsFromGraphQL(data), fetchedAt };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isScopeError(msg)) {
      return { available: false, reason: SCOPE_REASON, payouts: [], balance: null, currency: null, fetchedAt, error: msg };
    }
    // Transient failure: keep the last good numbers so the forecast doesn't blank.
    if (last?.available) return { ...last, error: msg };
    return { available: false, reason: "Couldn't reach Shopify for payouts just now.", payouts: [], balance: null, currency: null, fetchedAt: null, error: msg };
  }
}

/** Cached 10 minutes; never throws. */
export async function loadShopifyPayouts(): Promise<ShopifyPayoutsResult> {
  if (last && Date.now() - lastAt < CACHE_MS) return last;
  if (!inflight) {
    inflight = fetchFresh()
      .then(r => {
        // Only a real answer resets the clock; a failure retries next call.
        if (!r.error || r.reason === SCOPE_REASON) {
          last = r;
          lastAt = Date.now();
        }
        return r;
      })
      .catch((err): ShopifyPayoutsResult => ({
        available: false, payouts: [], balance: null, currency: null, fetchedAt: null,
        error: err instanceof Error ? err.message : String(err),
      }))
      .finally(() => { inflight = null; });
  }
  return inflight;
}
