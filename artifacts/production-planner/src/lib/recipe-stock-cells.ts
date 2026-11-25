/**
 * The "In fridge" and "On Shopify" cells on the Recipes table (Graeme,
 * 25 Nov 2026) — two different numbers: what's physically in the fridge
 * downstairs, and what Shopify will let customers buy. Server: api-server
 * routes/recipe-stock.ts. Pure and tested. Objective C.
 *
 * On Shopify looks only at listings customers can buy: Active AND on the
 * website. Of those, a listing Shopify counts stock for (tracked, stops at
 * 0) shows its "available" number. One Shopify doesn't count (untracked, or
 * set to keep selling at 0) never sells out on stock, so it reads
 * "No limit" — on 25 Nov 2026 that was every core calzone, whose old
 * "available" figures (−15,175, 88,658…) mean nothing. Two counted live
 * listings are shown side by side ("12 · 4"), never added: each sells its
 * own stock.
 */
export interface ListingStock {
  variantId: string;
  productTitle: string;
  variantTitle: string | null;
  status: string | null;
  tracked: boolean | null;
  policy?: string | null;
  online?: boolean | null;
  available: number | null;
}

export interface StockCell {
  text: string;
  /** Sorting: higher = more stock; no number sorts last either way round. */
  sortValue: number | null;
  title: string;
  tone: "normal" | "muted" | "low" | "warn";
}

const listingName = (l: ListingStock) => (l.variantTitle ? `${l.productTitle} · ${l.variantTitle}` : l.productTitle);
const statusWord = (s: string | null) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : "unknown");

/** Shopify stops selling this listing when its stock runs out. */
function counted(l: ListingStock): boolean {
  return l.tracked === true && l.policy !== "CONTINUE";
}

function describe(l: ListingStock): string {
  const where = l.status !== "ACTIVE" ? statusWord(l.status) : l.online === false ? "active, not on the website" : "on the website";
  if (l.tracked === false) return `not counted (${where})`;
  if (l.policy === "CONTINUE") return `${l.available ?? "?"} — keeps selling at 0 (${where})`;
  return `${l.available ?? "?"} available (${where})`;
}

export function fridgeCell(packs: number | null | undefined): StockCell {
  if (packs == null) return { text: "—", sortValue: null, title: "No fridge count for this recipe", tone: "muted" };
  return {
    text: String(packs),
    sortValue: packs,
    title: `${packs} two-pack${packs === 1 ? "" : "s"} in the production fridge (latest count)`,
    tone: packs <= 0 ? "low" : "normal",
  };
}

export function shopifyCell(listings: readonly ListingStock[] | undefined, shopifyRead: boolean): StockCell {
  const all = listings ?? [];
  if (all.length === 0) return { text: "—", sortValue: null, title: "No Shopify listing linked", tone: "muted" };
  if (!shopifyRead || all.every(l => l.available == null && l.status == null)) {
    return { text: "?", sortValue: null, title: "Couldn't reach Shopify just now", tone: "muted" };
  }
  const lines = all.map(l => `${listingName(l)}: ${describe(l)}`);
  const onSale = all.filter(l => l.status === "ACTIVE" && l.online !== false);
  const live = onSale.filter(l => counted(l) && l.available != null);
  // A customer can buy from ANY listing on the website, so one that never
  // sells out wins, even beside a counted one (Chicken & Chorizo, 25 Nov).
  const anyUnlimited = onSale.some(l => !counted(l));
  if (live.length === 0 || anyUnlimited) {
    const unlimited = onSale.length > 0;
    return {
      text: unlimited ? "No limit" : "Not on sale",
      sortValue: unlimited ? Number.MAX_SAFE_INTEGER : null,
      title: [unlimited ? "Shopify isn't counting stock for the listing on the website, so it never sells out on stock" : "No listing on the website", ...lines].join("\n"),
      tone: "muted",
    };
  }
  const nums = live.map(l => l.available!);
  const total = nums.reduce((a, b) => a + b, 0);
  return {
    text: nums.join(" · "),
    sortValue: total,
    title: lines.join("\n"),
    tone: nums.some(n => n < 0) ? "warn" : total <= 0 ? "low" : "normal",
  };
}
