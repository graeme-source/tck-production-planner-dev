/**
 * Wish List — "Equipment & things we need" (Graeme, 23 Oct 2026;
 * objective E). Types and the pure screen rules: sorting, filtering,
 * price wording and the votes bar. The vote and duplicate rules
 * themselves live on the server (api-server lib/wish-list.ts) — the
 * screen only shows what it's told.
 */

export const WISH_LIST_NAME = "Wish List";
export const WISH_LIST_SUBTITLE = "Equipment & things we need";
export const WISH_LIST_PATH = "/wish-list";

export type WishListStatus = "requested" | "approved" | "ordered" | "received" | "declined";

export interface WishListVotes {
  total: number;
  people: number;
  days: number;
  votedToday: boolean;
}

export interface WishListItem {
  id: number;
  url: string | null;
  title: string;
  pricePence: number | null;
  priceIncludesVat: boolean | null;
  priceExVatPence: number | null;
  currency: string;
  imageUrl: string | null;
  storeName: string | null;
  notes: string | null;
  quantity: number;
  status: WishListStatus;
  statusNote: string | null;
  statusChangedAt: string | null;
  statusChangedByName: string | null;
  orderedAt: string | null;
  orderedByName: string | null;
  receivedAt: string | null;
  createdByName: string | null;
  createdAt: string;
  mine: boolean;
  canEdit: boolean;
  votes: WishListVotes;
  /** How many comments — the thread itself opens on tap (migration 0343). */
  commentCount: number;
}

export interface WishListComment { id: number; userName: string; comment: string; createdAt: string; mine: boolean }

/** "Comments (2)" / "Comment" — the row button, so a thread is seen without showing it. */
export function commentButtonLabel(count: number): string {
  return count > 0 ? `${count} comment${count === 1 ? "" : "s"}` : "Comment";
}

export interface LinkReading {
  title: string | null;
  pricePence: number | null;
  priceIncludesVat: boolean | null;
  priceExVatPence: number | null;
  currency: string | null;
  imageUrl: string | null;
  storeName: string | null;
}

export const STATUS_LABEL: Record<WishListStatus, string> = {
  requested: "Asked for",
  approved: "Approved",
  ordered: "Ordered",
  received: "Received",
  declined: "Declined",
};

export const STATUS_TONE: Record<WishListStatus, string> = {
  requested: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
  approved: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  ordered: "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-100",
  received: "bg-secondary text-foreground",
  declined: "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100",
};

export type WishListFilter = "open" | "ordered" | "received" | "declined" | "all";
// "All" first and selected on arrival, so everyone sees what's been ordered
// as well as what's still asked for (Graeme, 28 Oct 2026).
export const FILTERS: Array<{ key: WishListFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "ordered", label: "Ordered" },
  { key: "received", label: "Received" },
  { key: "declined", label: "Declined" },
];
export const DEFAULT_FILTER: WishListFilter = "all";

export type WishListSort = "votes" | "newest" | "oldest" | "price-low" | "price-high";
export const SORTS: Array<{ key: WishListSort; label: string }> = [
  { key: "votes", label: "Most votes" },
  { key: "newest", label: "Newest" },
  { key: "oldest", label: "Oldest" },
  { key: "price-low", label: "Price: low to high" },
  { key: "price-high", label: "Price: high to low" },
];

export function matchesFilter(item: Pick<WishListItem, "status">, filter: WishListFilter): boolean {
  switch (filter) {
    case "open": return item.status === "requested" || item.status === "approved";
    case "ordered": return item.status === "ordered";
    case "received": return item.status === "received";
    case "declined": return item.status === "declined";
    case "all": return true;
  }
}

export function matchesSearch(item: Pick<WishListItem, "title" | "storeName" | "createdByName" | "notes">, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [item.title, item.storeName, item.createdByName, item.notes].filter(Boolean).join(" ").toLowerCase();
  return words.every(w => hay.includes(w));
}

/** Sorted copy. Ties fall back to newest first; items with no price go to
 *  the end of either price order. */
export function sortItems<T extends Pick<WishListItem, "id" | "createdAt" | "pricePence" | "votes">>(items: readonly T[], sort: WishListSort): T[] {
  const newest = (a: T, b: T) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id;
  const priceOf = (x: T) => x.pricePence;
  return [...items].sort((a, b) => {
    switch (sort) {
      case "votes": return b.votes.total - a.votes.total || b.votes.people - a.votes.people || newest(a, b);
      case "newest": return newest(a, b);
      case "oldest": return -newest(a, b);
      case "price-low":
      case "price-high": {
        const pa = priceOf(a), pb = priceOf(b);
        if (pa == null && pb == null) return newest(a, b);
        if (pa == null) return 1;
        if (pb == null) return -1;
        return (sort === "price-low" ? pa - pb : pb - pa) || newest(a, b);
      }
    }
  });
}

export function visibleItems(items: readonly WishListItem[], opts: { filter: WishListFilter; sort: WishListSort; query: string }): WishListItem[] {
  return sortItems(items.filter(i => matchesFilter(i, opts.filter) && matchesSearch(i, opts.query)), opts.sort);
}

export function countsByFilter(items: readonly Pick<WishListItem, "status">[]): Record<WishListFilter, number> {
  const out = { open: 0, ordered: 0, received: 0, declined: 0, all: items.length } as Record<WishListFilter, number>;
  for (const i of items) for (const f of ["open", "ordered", "received", "declined"] as const) if (matchesFilter(i, f)) out[f]++;
  return out;
}

const SYMBOL: Record<string, string> = { GBP: "£", EUR: "€", USD: "$" };

/** "£654.12" — whole pounds drop the pence ("£12"). Null price → null. */
export function formatPence(pence: number | null, currency = "GBP"): string | null {
  if (pence == null) return null;
  const sym = SYMBOL[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;
  const pounds = pence / 100;
  const text = pence % 100 === 0
    ? pounds.toLocaleString("en-GB", { maximumFractionDigits: 0 })
    : pounds.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sym}${text}`;
}

/** "inc VAT" / "ex VAT" / "" — what the shop told us about the price. */
export function vatWord(includesVat: boolean | null): string {
  return includesVat === true ? "inc VAT" : includesVat === false ? "ex VAT" : "";
}

/** "£12.50 → 1250"; blank → null; nonsense → undefined (so the form can
 *  say "that's not a price"). */
export function poundsInputToPence(text: string): number | null | undefined {
  const t = text.replace(/[£$€,\s]/g, "");
  if (!t) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return undefined;
  return Math.round(Number(t) * 100);
}

export function penceToPoundsInput(pence: number | null): string {
  if (pence == null) return "";
  return (pence / 100).toFixed(2).replace(/\.00$/, "");
}

/** How long the votes bar is, against the most-voted open item (the
 *  biggest pain point = 100%). Something with votes is never invisible. */
export function voteBarPercent(votes: number, topVotes: number): number {
  if (votes <= 0 || topVotes <= 0) return 0;
  return Math.max(6, Math.round((Math.min(votes, topVotes) / topVotes) * 100));
}

/** "voted on 3 different days by 2 people" / "1 vote, from Sam" style
 *  line under the count. */
export function voteSpreadLine(v: Pick<WishListVotes, "total" | "people" | "days">): string {
  if (v.total === 0) return "No votes yet";
  const days = v.days === 1 ? "1 day" : `${v.days} different days`;
  const people = v.people === 1 ? "1 person" : `${v.people} people`;
  return `on ${days} by ${people}`;
}

/** Does this look like a link someone pasted (vs. typed words)? */
export function looksLikeLink(text: string): boolean {
  const t = text.trim();
  if (!t || /\s/.test(t)) return false;
  return /^https?:\/\//i.test(t) || /^www\./i.test(t) || /^[a-z0-9-]+(\.[a-z0-9-]+)+\/\S+/i.test(t);
}
