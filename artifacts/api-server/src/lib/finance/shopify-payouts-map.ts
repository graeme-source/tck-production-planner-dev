// Shopify Payments payouts → cash-flow rows. Pure, tested.
//
// Shopify's ShopifyPaymentsPayout has no "arrives in bank" field — only
// `issuedAt` (when Shopify sends it, or will send it for SCHEDULED ones). We
// use that London date as the payout date; UK bank arrival is usually the same
// or next working day, so callers wanting a cautious forecast can add a day.

import { londonDateString } from "../london-time";

export type ShopifyPayoutStatus = "SCHEDULED" | "IN_TRANSIT" | "PAID" | "FAILED" | "CANCELED";

export interface ShopifyPayout {
  id: string;
  /** YYYY-MM-DD London: the payout's issued (expected transfer) date. */
  date: string;
  status: ShopifyPayoutStatus;
  /** Signed: positive = money into the bank, negative = Shopify takes money out. */
  net: number;
  currency: string;
}

const STATUSES = new Set<ShopifyPayoutStatus>(["SCHEDULED", "IN_TRANSIT", "PAID", "FAILED", "CANCELED"]);

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function money(v: unknown): { amount: number; currency: string } | null {
  const m = obj(v);
  if (!m) return null;
  const amount = Number(m.amount);
  const currency = typeof m.currencyCode === "string" ? m.currencyCode : null;
  if (!Number.isFinite(amount) || !currency) return null;
  return { amount, currency };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Accepts the `data` object of the payouts query (or the response wrapped in
 * `{ data }`) and returns payouts newest first. Bad rows are skipped, never thrown.
 */
export function payoutsFromGraphQL(raw: unknown): {
  payouts: ShopifyPayout[];
  balance: number | null;
  currency: string | null;
} {
  const root = obj(raw);
  const data = obj(root?.data) ?? root;
  const account = obj(data?.shopifyPaymentsAccount);
  if (!account) return { payouts: [], balance: null, currency: null };

  const payouts: ShopifyPayout[] = [];
  const conn = obj(account.payouts);
  const nodes = Array.isArray(conn?.nodes)
    ? conn.nodes
    : Array.isArray(conn?.edges)
      ? conn.edges.map(e => obj(e)?.node)
      : [];
  for (const n of nodes) {
    const p = obj(n);
    if (!p || typeof p.id !== "string") continue;
    const status = String(p.status) as ShopifyPayoutStatus;
    if (!STATUSES.has(status)) continue;
    const issued = typeof p.issuedAt === "string" ? new Date(p.issuedAt) : null;
    if (!issued || Number.isNaN(issued.getTime())) continue;
    const net = money(p.net);
    if (!net) continue;
    // A WITHDRAWAL pulls money back out of the bank (e.g. negative balance
    // after refunds/chargebacks). Shopify reports its amount unsigned, so sign it.
    const amount = p.transactionType === "WITHDRAWAL" && net.amount > 0 ? -net.amount : net.amount;
    payouts.push({ id: p.id, date: londonDateString(issued), status, net: round2(amount), currency: net.currency });
  }
  payouts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  // balance is a list, one entry per currency. Prefer the account's default
  // currency; otherwise take the first. Empty list = unknown, not zero.
  const balances = Array.isArray(account.balance) ? account.balance.map(money).filter(Boolean) as Array<{ amount: number; currency: string }> : [];
  const preferred = typeof account.defaultCurrency === "string" ? account.defaultCurrency : null;
  const bal = balances.find(b => b.currency === preferred) ?? balances[0] ?? null;

  return {
    payouts,
    balance: bal ? round2(bal.amount) : null,
    currency: bal?.currency ?? payouts[0]?.currency ?? preferred,
  };
}
