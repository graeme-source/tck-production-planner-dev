/**
 * Wish List rules — pure, no database (Graeme, 23 Oct 2026; objective E).
 *
 *  - Links are stored CLEAN: tracking parameters (utm_*, gclid, gbraid,
 *    gad_*, fbclid…) and #fragments are removed, Amazon links are cut down
 *    to /dp/ASIN. The same cleaning decides "already on the list".
 *  - Duplicates: same cleaned link, or a near-identical title.
 *  - Votes: one per person per item per London day; adding counts as the
 *    requester's first vote.
 *  - Reading a product page: JSON-LD Product first, then og:/product: meta
 *    tags, then Amazon's own markup, then the <title>. The AI fallback lives
 *    in the route (it needs the network); this file only reads HTML.
 *
 * Used by routes/wish-list.ts.
 */
import { isFounderEmail } from "./founder-email";

export const WISH_LIST_STATUSES = ["requested", "approved", "ordered", "received", "declined"] as const;
export type WishListStatus = (typeof WISH_LIST_STATUSES)[number];

/**
 * Who gets the must-dismiss "something's been added" pop-up and may
 * approve / order / decline / edit / delete any item: the founder, plus
 * anyone whose role is in this list. Change the list to widen or narrow it.
 */
export const WISH_LIST_MANAGER_ROLES: readonly string[] = ["admin"];

export function canManageWishList(user: { email: string | null | undefined; role: string | null | undefined }): boolean {
  return isFounderEmail(user.email) || (!!user.role && WISH_LIST_MANAGER_ROLES.includes(user.role));
}

/** The requester may edit their own item while it's still "requested". */
export function canEditItem(
  item: { createdByUserId: number | null; status: string },
  user: { id: number; canManage: boolean },
): boolean {
  if (user.canManage) return true;
  return item.createdByUserId === user.id && item.status === "requested";
}

// ── Links ────────────────────────────────────────────────────────────────

const TRACKING_PARAM_EXACT = new Set([
  "gclid", "gbraid", "wbraid", "dclid", "fbclid", "msclkid", "yclid", "twclid", "ttclid",
  "igshid", "igsh", "mc_cid", "mc_eid", "_ga", "_gl", "_hsenc", "_hsmi", "_kx", "li_fat_id",
  "srsltid", "epik", "ref_", "spm", "scm", "gs_lcrp", "trk", "trkcampaign",
  "s_kwcid", "ef_id", "cmpid", "affid", "irclickid", "clickid",
]);
const TRACKING_PARAM_PREFIXES = ["utm_", "gad_", "hsa_", "pk_", "mtm_", "_branch", "matomo_", "ga_"];

function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return TRACKING_PARAM_EXACT.has(k) || TRACKING_PARAM_PREFIXES.some(p => k.startsWith(p));
}

function isAmazonHost(host: string): boolean {
  return /(^|\.)amazon\.[a-z.]+$/i.test(host);
}

/**
 * The link as we store it: http(s) only, tracking parameters and the
 * #fragment removed, Amazon product links cut to https://www.amazon.xx/dp/ASIN.
 * Returns null for anything that isn't a web link.
 */
export function cleanProductUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname.includes(".")) return null;
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();

  if (isAmazonHost(url.hostname)) {
    const asin = /\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin)\/([A-Z0-9]{10})(?:[/?]|$)/i.exec(url.pathname + "/")?.[1];
    if (asin) return `https://${url.hostname}/dp/${asin.toUpperCase()}`;
  }

  for (const key of [...url.searchParams.keys()]) {
    if (isTrackingParam(key)) url.searchParams.delete(key);
  }
  // URLSearchParams leaves a bare "?" when everything was removed.
  let out = url.toString();
  if (out.endsWith("?")) out = out.slice(0, -1);
  return out;
}

/** What two links must share to count as the same thing: host without
 *  www., path without trailing slash (case-insensitive), the remaining
 *  query parameters in a fixed order. */
export function urlDuplicateKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const clean = cleanProductUrl(raw);
  if (!clean) return null;
  const url = new URL(clean);
  const host = url.hostname.replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "").toLowerCase();
  const params = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&") : "";
  return `${host}${path}${query}`;
}

// ── Titles & duplicates ──────────────────────────────────────────────────

function titleWords(title: string): string[] {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** Near-identical titles: the same words (order and punctuation ignored),
 *  or at least 85% overlap when both have four or more words. Short titles
 *  must match exactly — "Mop" vs "Mop bucket" are different things. */
export function titlesNearlySame(a: string, b: string): boolean {
  const wa = titleWords(a);
  const wb = titleWords(b);
  if (wa.length === 0 || wb.length === 0) return false;
  const sa = new Set(wa);
  const sb = new Set(wb);
  let shared = 0;
  for (const w of sa) if (sb.has(w)) shared++;
  const union = new Set([...sa, ...sb]).size;
  if (shared === union) return true;
  if (sa.size < 4 || sb.size < 4) return false;
  return shared / union >= 0.85;
}

export interface DuplicateCandidate {
  id: number;
  url: string | null;
  title: string;
  status: string;
}

/** An item already on the list for this link or title. Declined and
 *  received items don't count — asking again for something we turned down
 *  (or wore out) is a fresh request. */
export function findDuplicate<T extends DuplicateCandidate>(
  items: readonly T[],
  wanted: { url?: string | null; title?: string | null },
): T | null {
  const open = items.filter(i => i.status !== "declined" && i.status !== "received");
  const key = urlDuplicateKey(wanted.url ?? null);
  if (key) {
    const byUrl = open.find(i => urlDuplicateKey(i.url) === key);
    if (byUrl) return byUrl;
  }
  const title = wanted.title?.trim();
  if (title) {
    const byTitle = open.find(i => titlesNearlySame(i.title, title));
    if (byTitle) return byTitle;
  }
  return null;
}

// ── Prices ───────────────────────────────────────────────────────────────

/**
 * "£1,234.56", "654.12", "1.234,56 €", 12 → whole pence. Null when there's
 * no sensible number. A lone comma with two decimals ("12,50") is read as
 * a decimal point (European shops); otherwise commas are thousands.
 */
export function parsePriceToPence(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) : null;
  if (typeof raw !== "string") return null;
  const m = /\d[\d.,\s]*/.exec(raw.replace(/ /g, " "));
  if (!m) return null;
  let s = m[0].replace(/\s+/g, "").replace(/[.,]$/, "");
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // Whichever comes last is the decimal mark.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const decimals = s.length - lastComma - 1;
    s = decimals === 2 && s.indexOf(",") === lastComma ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (lastDot >= 0) {
    // "1.234" with three decimals and no other mark: thousands (European).
    const decimals = s.length - lastDot - 1;
    if (decimals === 3 && s.indexOf(".") !== lastDot) s = s.replace(/\./g, "");
    else if (decimals === 3 && /^\d{1,3}\.\d{3}$/.test(s)) s = s.replace(".", "");
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

// ── Votes ────────────────────────────────────────────────────────────────

export interface VoteRow { userId: number; voteDate: string }

/** May this person +1 today? One vote per person per item per London day. */
export function canVoteToday(votes: readonly VoteRow[], userId: number, today: string): boolean {
  return !votes.some(v => v.userId === userId && v.voteDate === today);
}

export interface VoteSummary {
  total: number;
  people: number;
  days: number;
  votedToday: boolean;
}

export function summariseVotes(votes: readonly VoteRow[], userId: number, today: string): VoteSummary {
  return {
    total: votes.length,
    people: new Set(votes.map(v => v.userId)).size,
    days: new Set(votes.map(v => v.voteDate)).size,
    votedToday: !canVoteToday(votes, userId, today),
  };
}

// ── New-item pop-up ──────────────────────────────────────────────────────

/** Items the manager hasn't acknowledged yet: added after their marker,
 *  not by themselves, and not deleted. No marker yet → only the last week,
 *  so a newly made admin isn't greeted with the whole history. */
export function unacknowledgedItems<T extends { id: number; createdByUserId: number | null; createdAt: Date; deletedAt: Date | null }>(
  items: readonly T[],
  viewerId: number,
  ackedUpToId: number | null,
  now: Date = new Date(),
): T[] {
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  return items
    .filter(i => !i.deletedAt && i.createdByUserId !== viewerId)
    .filter(i => (ackedUpToId == null ? i.createdAt.getTime() >= weekAgo : i.id > ackedUpToId))
    .sort((a, b) => a.id - b.id);
}

// ── Reading a product page ───────────────────────────────────────────────

export interface ProductPageReading {
  title: string | null;
  pricePence: number | null;
  /** true = the price includes VAT, false = ex VAT, null = page didn't say. */
  priceIncludesVat: boolean | null;
  priceExVatPence: number | null;
  currency: string | null;
  imageUrl: string | null;
  storeName: string | null;
}

const HTML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", pound: "£", euro: "€" };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => HTML_ENTITIES[n.toLowerCase()] ?? m);
}

function clean(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = decodeEntities(String(s)).replace(/\s+/g, " ").trim();
  return t || null;
}

function metaContent(html: string, key: string): string | null {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const a = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${esc}["'][^>]*content=["']([^"']*)["']`, "i").exec(html);
  if (a) return clean(a[1]);
  const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${esc}["']`, "i").exec(html);
  return b ? clean(b[1]) : null;
}

type Json = Record<string, unknown>;

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v == null ? [] : [v];
}

function hasType(node: Json, type: string): boolean {
  return asArray(node["@type"]).some(t => typeof t === "string" && t.toLowerCase() === type.toLowerCase());
}

/** Every Product node in the page's JSON-LD (handles @graph and arrays). */
function jsonLdProducts(html: string): Json[] {
  const out: Json[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const n = node as Json;
    if (hasType(n, "Product") || hasType(n, "ProductGroup")) out.push(n);
    if (n["@graph"]) visit(n["@graph"]);
  };
  while ((m = re.exec(html))) {
    try { visit(JSON.parse(m[1].trim())); } catch { /* broken JSON-LD — skip it */ }
  }
  return out;
}

function firstImage(v: unknown): string | null {
  for (const x of asArray(v)) {
    if (typeof x === "string" && /^https?:\/\//i.test(x)) return x;
    if (x && typeof x === "object") {
      const u = (x as Json)["url"] ?? (x as Json)["contentUrl"];
      if (typeof u === "string" && /^https?:\/\//i.test(u)) return u;
    }
  }
  return null;
}

interface OfferPrice { pence: number | null; currency: string | null; incVat: boolean | null; exVatPence: number | null }

function offerPrice(offers: unknown): OfferPrice | null {
  for (const raw of asArray(offers)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Json;
    const specs = asArray(o["priceSpecification"]).filter((s): s is Json => !!s && typeof s === "object");
    const inc = specs.find(s => s["valueAddedTaxIncluded"] === true || s["valueAddedTaxIncluded"] === "true");
    const ex = specs.find(s => s["valueAddedTaxIncluded"] === false || s["valueAddedTaxIncluded"] === "false");
    const price = parsePriceToPence(o["price"] ?? o["lowPrice"] ?? inc?.["price"] ?? specs[0]?.["price"]);
    const currency = (o["priceCurrency"] ?? inc?.["priceCurrency"] ?? specs[0]?.["priceCurrency"]) as string | undefined;
    if (price == null && !specs.length) continue;
    const incPence = inc ? parsePriceToPence(inc["price"]) : null;
    const exPence = ex ? parsePriceToPence(ex["price"]) : null;
    // Prefer the VAT-inclusive figure as the headline (what most shops show).
    const headline = incPence ?? price ?? exPence;
    let incVat: boolean | null = null;
    if (incPence != null && headline === incPence) incVat = true;
    else if (exPence != null && headline === exPence && incPence == null) incVat = false;
    return { pence: headline, currency: typeof currency === "string" ? currency.toUpperCase() : null, incVat, exVatPence: exPence };
  }
  return null;
}

const SITE_NAMES: Array<[RegExp, string]> = [
  [/(^|\.)amazon\.co\.uk$/, "Amazon"],
  [/(^|\.)amazon\.[a-z.]+$/, "Amazon"],
  [/(^|\.)ggmgastro\.com$/, "GGM Gastro"],
  [/(^|\.)nisbets\.co\.uk$/, "Nisbets"],
  [/(^|\.)ebay\.co\.uk$/, "eBay"],
  [/(^|\.)screwfix\.com$/, "Screwfix"],
  [/(^|\.)toolstation\.com$/, "Toolstation"],
  [/(^|\.)ikea\.com$/, "IKEA"],
  [/(^|\.)argos\.co\.uk$/, "Argos"],
  [/(^|\.)brakes\.co\.uk$/, "Brakes"],
];

/** A shop name for the link: known shops by name, else og:site_name, else
 *  the bare host ("example.co.uk"). */
export function storeNameFor(url: string | null, siteName?: string | null): string | null {
  if (!url) return siteName ?? null;
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return siteName ?? null; }
  for (const [re, name] of SITE_NAMES) if (re.test(host)) return name;
  return siteName ?? host.replace(/^www\./, "");
}

/** Remove " | Shop name" / " - Shop name" / " : Amazon.co.uk: …" tails. */
export function stripSiteSuffix(title: string, siteName: string | null): string {
  let t = title.replace(/\s*:\s*Amazon\.[a-z.]+.*$/i, "").replace(/^Amazon\.[a-z.]+\s*:\s*/i, "");
  // " | Anything" is nearly always the shop; " - X" only when X is the
  // shop's own name or a web address ("Mop - Blue" keeps its colour).
  const sep = /\s+([|–—-])\s+([^|–—-]+)$/.exec(t);
  if (sep) {
    const tail = sep[2].trim().toLowerCase();
    const isShop = (siteName && tail === siteName.toLowerCase()) || /\.[a-z]{2,}$/.test(tail);
    if (sep[1] === "|" || isShop) t = t.slice(0, sep.index);
  }
  return t.trim();
}

export function readProductPage(html: string, pageUrl: string | null): ProductPageReading {
  const products = jsonLdProducts(html);
  const ld = products[0] ?? null;
  const siteName = metaContent(html, "og:site_name");

  let title = clean(ld?.["name"] as string | undefined);
  if (!title) {
    const amazon = /<span[^>]+id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i.exec(html)?.[1];
    if (amazon) title = clean(amazon.replace(/<[^>]+>/g, " "));
  }
  if (!title) {
    const og = metaContent(html, "og:title") ?? metaContent(html, "twitter:title");
    if (og) title = stripSiteSuffix(og, siteName);
  }
  if (!title) {
    const tag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
    if (tag) title = stripSiteSuffix(clean(tag) ?? "", siteName) || null;
  }

  let price: OfferPrice | null = null;
  for (const p of products) {
    price = offerPrice(p["offers"]);
    if (price?.pence != null) break;
  }
  if (price?.pence == null) {
    const amount = metaContent(html, "product:price:amount") ?? metaContent(html, "og:price:amount") ?? metaContent(html, "price");
    if (amount) {
      price = {
        pence: parsePriceToPence(amount),
        currency: (metaContent(html, "product:price:currency") ?? metaContent(html, "og:price:currency") ?? metaContent(html, "priceCurrency"))?.toUpperCase() ?? null,
        incVat: null,
        exVatPence: null,
      };
    }
  }
  if (price?.pence == null) {
    // Amazon: the first .a-offscreen inside the buy box is the price.
    const amazon = /<span[^>]+class=["'][^"']*a-offscreen[^"']*["'][^>]*>\s*([£$€][^<]+)<\/span>/i.exec(html)?.[1];
    if (amazon) {
      const sym = amazon.trim()[0];
      price = { pence: parsePriceToPence(amazon), currency: sym === "£" ? "GBP" : sym === "€" ? "EUR" : "USD", incVat: null, exVatPence: null };
    }
  }

  // Shops that say so in words ("gross price incl. 20% VAT", "ex VAT").
  if (price && price.incVat == null) {
    const text = html.replace(/<[^>]+>/g, " ");
    const incWords = /\b(inc\.?|incl\.?|including)\s*(\d+%\s*)?VAT\b/i.test(text);
    const exWords = /\b(ex\.?|excl\.?|excluding|plus|\+)\s*(\d+%\s*)?VAT\b/i.test(text);
    if (incWords && !exWords) price.incVat = true;
    else if (exWords && !incWords) price.incVat = false;
  }

  let imageUrl = firstImage(ld?.["image"]) ?? metaContent(html, "og:image") ?? metaContent(html, "twitter:image");
  if (!imageUrl) {
    const hires = /<img[^>]+id=["']landingImage["'][^>]*data-old-hires=["'](https?:\/\/[^"']+)["']/i.exec(html)?.[1]
      ?? /<img[^>]+id=["']landingImage["'][^>]*src=["'](https?:\/\/[^"']+)["']/i.exec(html)?.[1];
    imageUrl = hires ?? null;
  }
  if (imageUrl && !/^https?:\/\//i.test(imageUrl) && pageUrl) {
    try { imageUrl = new URL(imageUrl, pageUrl).toString(); } catch { imageUrl = null; }
  }

  const brandName = ld?.["brand"] && typeof ld["brand"] === "object" ? clean((ld["brand"] as Json)["name"] as string) : null;

  return {
    title: title ? title.slice(0, 300) : null,
    pricePence: price?.pence ?? null,
    priceIncludesVat: price?.incVat ?? null,
    priceExVatPence: price?.exVatPence ?? null,
    currency: price?.currency ?? null,
    imageUrl,
    storeName: storeNameFor(pageUrl, siteName ?? brandName),
  };
}

/** A readable name from the link itself, for when the shop won't let us
 *  read the page: the last meaningful path segment, dashes to spaces,
 *  first letter capitalised. Null if nothing usable. */
export function titleFromUrl(url: string | null): string | null {
  if (!url) return null;
  let path: string;
  try { path = decodeURIComponent(new URL(url).pathname); } catch { return null; }
  const segments = path.split("/").filter(Boolean);
  // Wanted: a slug with real words in it (three lowercase letters in a
  // row), not a product code like an Amazon ASIN or "c123".
  const best = [...segments].reverse().find(s => /[a-z]{3,}/.test(s.replace(/\.(html?|php|aspx?)$/i, "")) && !/^(dp|gp|product|products)$/i.test(s));
  if (!best) return null;
  const words = best.replace(/\.(html?|php|aspx?)$/i, "").replace(/[-_+]+/g, " ").replace(/\s+/g, " ").trim();
  if (words.length < 3) return null;
  return (words[0].toUpperCase() + words.slice(1)).slice(0, 300);
}

// ── Comments (migration 0343) ──────────────────────────────────────────────

/** Who hears about a new comment: the person who asked for the item and
 *  everyone who has commented before — never the writer, never twice. */
export function commentRecipients(input: {
  requesterId: number | null;
  earlierCommenterIds: ReadonlyArray<number | null>;
  authorId: number;
}): number[] {
  const out = new Set<number>();
  if (input.requesterId != null) out.add(input.requesterId);
  for (const id of input.earlierCommenterIds) if (id != null) out.add(id);
  out.delete(input.authorId);
  return [...out];
}

/** The bell line: "Lorna Brown commented on your wish list item: Spray bottles". */
export function commentNotificationMessage(authorName: string, itemTitle: string, isRequester: boolean): string {
  const title = itemTitle.length > 80 ? `${itemTitle.slice(0, 77)}…` : itemTitle;
  return `${authorName} commented on ${isRequester ? "your" : "a"} wish list item: ${title}`;
}
