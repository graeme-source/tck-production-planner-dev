/**
 * Lucky Order Number — the rules, as pure functions (Graeme, 27 Oct 2026).
 * Objective I. The engine (engine.ts) does the Shopify and email work; this
 * file only decides.
 *
 *   order number ends in 000 -> "subscription": a year of free subscription
 *                               ONLY (no gift, no refund — it's valuable on
 *                               its own)
 *   ends in 00 (not 000)     -> "gift_refund": free gift + full refund
 *   ends in 0  (not 00)      -> "gift": free gift
 *
 * Qualifying orders: placed on the website or a subscription renewal, not
 * wholesale, not cancelled, inside the offer's window. Every order counts
 * towards the numbering, so a winning number that lands on a wholesale order
 * simply isn't won — the prize never rolls on to the next order.
 */
import { createHash } from "node:crypto";

export type LuckyTier = "gift" | "gift_refund" | "subscription";

export const TIER_LABEL: Record<LuckyTier, string> = {
  gift: "Free gift",
  gift_refund: "Free gift + full refund",
  subscription: "Free subscription year",
};

/** "#138100" -> 138100. Null when the name has no trailing number. */
export function orderNumberFromName(name: string): number | null {
  const m = /(\d+)\D*$/.exec(name ?? "");
  return m ? Number(m[1]) : null;
}

export function luckyTier(orderNumber: number): LuckyTier | null {
  if (!Number.isInteger(orderNumber) || orderNumber <= 0) return null;
  if (orderNumber % 1000 === 0) return "subscription";
  if (orderNumber % 100 === 0) return "gift_refund";
  if (orderNumber % 10 === 0) return "gift";
  return null;
}

export const tierHasGift = (t: LuckyTier) => t === "gift" || t === "gift_refund";
export const tierHasRefund = (t: LuckyTier) => t === "gift_refund";
export const tierHasCode = (t: LuckyTier) => t === "subscription";

export interface OfferWindow {
  enabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  /** When the offer was last switched on — nothing placed before wins. */
  activatedAt: string | null;
}

/** Earliest order time that can win, or null when the offer isn't on. */
export function windowStart(w: OfferWindow): string | null {
  if (!w.enabled) return null;
  const starts = [w.startsAt, w.activatedAt].filter((x): x is string => !!x).map(x => Date.parse(x));
  return starts.length ? new Date(Math.max(...starts)).toISOString() : null;
}

/** Is the offer running at this moment? */
export function offerLiveAt(w: OfferWindow, at: Date): boolean {
  const start = windowStart(w);
  if (!start) return false;
  if (at.getTime() < Date.parse(start)) return false;
  if (w.endsAt && at.getTime() >= Date.parse(w.endsAt)) return false;
  return true;
}

export interface OrderFacts {
  name: string;
  createdAt: string;
  sourceName: string | null;
  tags: string[];
  cancelledAt: string | null;
}

/** Website checkout, or a subscription renewal (Shopify's subscription sources). */
export function isWebsiteOrRenewal(sourceName: string | null): boolean {
  const s = (sourceName ?? "").toLowerCase();
  return s === "web" || s.startsWith("subscription_contract");
}

export type Disqualified = "not_website" | "wholesale" | "cancelled" | "outside_window";

export function disqualified(o: OrderFacts, w: OfferWindow): Disqualified | null {
  if (!offerLiveAt(w, new Date(o.createdAt))) return "outside_window";
  if (o.cancelledAt) return "cancelled";
  if (o.tags.some(t => t.trim().toLowerCase() === "wholesale")) return "wholesale";
  if (!isWebsiteOrRenewal(o.sourceName)) return "not_website";
  return null;
}

/** The tier this order wins, or null. */
export function winningTier(o: OrderFacts, w: OfferWindow): LuckyTier | null {
  const n = orderNumberFromName(o.name);
  if (n == null) return null;
  const tier = luckyTier(n);
  if (!tier) return null;
  return disqualified(o, w) ? null : tier;
}

/** Refunds above the limit wait for the founder's one-click approval. */
export function refundNeedsApproval(amount: number, autoLimit: number): boolean {
  return amount > autoLimit;
}

/**
 * The 000 winner's code: readable, tied to the order, not guessable from
 * the order number alone. The same order always gets the same code, so a
 * retry after a crash finds the code it already made instead of minting two.
 */
export function subscriptionCodeFor(orderId: string, orderNumber: number, secret: string): string {
  const h = createHash("sha256").update(`${secret}:${orderId}`).digest("hex").slice(0, 6).toUpperCase();
  return `LUCKYYEAR-${orderNumber}-${h}`;
}

/** Initial step statuses for a new winner. */
export function initialStatuses(tier: LuckyTier, practice: boolean) {
  const step = (applies: boolean) => (!applies ? "n/a" : practice ? "practice" : "pending");
  return {
    giftStatus: step(tierHasGift(tier)),
    refundStatus: step(tierHasRefund(tier)),
    codeStatus: step(tierHasCode(tier)),
    emailStatus: step(true),
  };
}
