/**
 * Finding what's just been delivered — the search behind "Record an
 * unexpected delivery" (Graeme, 2026-09-25: "search by supplier or item
 * number, and really quickly and easily find the bits that we want").
 *
 * One box searches item name, brand, supplier (first or second) and the
 * supplier's part / item number, forgivingly:
 *   - every word you type has to match something, in any order;
 *   - a word matches the start of a word, the middle of a name, or — for
 *     longer words — a near-miss spelling ("mozarella" finds Mozzarella);
 *   - part numbers ignore spaces, dashes and case ("a35006" = "A 35006"),
 *     and are NOT treated as unique — suppliers reuse them, so every item
 *     carrying the number is returned.
 *
 * Pure (no React, no fetch) so it's unit-tested.
 * Objective F — effortless daily use.
 */

export interface DeliveryCatalogueItem {
  id: number;
  name: string;
  category: string | null;
  unit: string;
  packWeight: number;
  costPerPack: number;
  stockInPacks: boolean;
  brand: string | null;
  supplierPartNumber: string | null;
  supplierId: number | null;
  supplierName: string | null;
  secondarySupplierId: number | null;
  secondarySupplierName: string | null;
}

/** Lower-case, accents stripped, punctuation turned into spaces. */
export function normaliseSearchText(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Letters and digits only — for part numbers, where spacing is noise. */
export function compactCode(s: string | null | undefined): string {
  return normaliseSearchText(s).replace(/ /g, "");
}

/** Levenshtein distance, giving up (returning max + 1) once it exceeds `max`. */
export function editDistanceWithin(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** How many typos a word of this length is allowed. */
function typoAllowance(len: number): number {
  // Short words get no typo allowance: "tape" one letter off is "type",
  // "tap", "rape(seed)" — noise, not help.
  if (len >= 8) return 2;
  if (len >= 5) return 1;
  return 0;
}

/** Best score for one typed word against one text field (already normalised). */
function wordScore(token: string, field: string): number {
  if (!field) return 0;
  const words = field.split(" ");
  let best = 0;
  for (const w of words) {
    if (w === token) return 40;
    if (w.startsWith(token)) best = Math.max(best, 30);
  }
  if (best) return best;
  if (token.length >= 2 && field.replace(/ /g, "").includes(token)) return 20;
  const allowance = typoAllowance(token.length);
  if (allowance > 0) {
    for (const w of words) {
      // Compare against the word, and against the word's first N letters so
      // a misspelt prefix ("chiken") still finds "chicken".
      const candidates = [w, w.slice(0, token.length)];
      for (const c of candidates) {
        if (c.length >= 3 && editDistanceWithin(token, c, allowance) <= allowance) return 12;
      }
    }
  }
  return 0;
}

function partNumberScore(token: string, part: string): number {
  if (!part || !token) return 0;
  if (part === token) return 120;
  if (token.length >= 2 && part.startsWith(token)) return 80;
  // Below an exact name word (40): a code that merely CONTAINS the word
  // ("TCK Large boxes") shouldn't outrank an item actually called that.
  if (token.length >= 3 && part.includes(token)) return 35;
  return 0;
}

export interface ItemSearchHit {
  item: DeliveryCatalogueItem;
  score: number;
  /** What matched, for the card ("Item no. A 35006"). */
  matchedOn: Array<"name" | "brand" | "supplier" | "partNumber">;
}

/** True when the item can come from this supplier (first or second choice). */
export function itemComesFrom(item: DeliveryCatalogueItem, supplierId: number): boolean {
  return item.supplierId === supplierId || item.secondarySupplierId === supplierId;
}

/**
 * Search the catalogue. With a supplier chosen, only that supplier's items
 * are searched, and an empty box lists all of them A–Z. With no supplier
 * and an empty box, nothing is shown (a 300-item wall helps nobody).
 */
export function searchDeliveryItems(
  items: DeliveryCatalogueItem[],
  query: string,
  opts: { supplierId?: number | null; limit?: number } = {},
): ItemSearchHit[] {
  const limit = opts.limit ?? 40;
  const pool = opts.supplierId != null ? items.filter(i => itemComesFrom(i, opts.supplierId!)) : items;
  const q = normaliseSearchText(query);

  if (!q) {
    if (opts.supplierId == null) return [];
    return [...pool]
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit)
      .map(item => ({ item, score: 0, matchedOn: [] }));
  }

  const tokens = q.split(" ");
  const wholeCode = compactCode(query);
  const hits: ItemSearchHit[] = [];

  for (const item of pool) {
    const name = normaliseSearchText(item.name);
    const brand = normaliseSearchText(item.brand);
    const suppliers = normaliseSearchText(`${item.supplierName ?? ""} ${item.secondarySupplierName ?? ""}`);
    const part = compactCode(item.supplierPartNumber);
    const matched = new Set<ItemSearchHit["matchedOn"][number]>();

    // The whole query as one code: "A 35006" typed with a space is still
    // one part number, not the words "a" and "35006".
    const wholePart = wholeCode.length >= 3 ? partNumberScore(wholeCode, part) : 0;

    let total = 0;
    let everyTokenMatched = true;
    for (const t of tokens) {
      const scores = {
        name: wordScore(t, name),
        brand: Math.round(wordScore(t, brand) * 0.6),
        supplier: Math.round(wordScore(t, suppliers) * 0.6),
        partNumber: partNumberScore(t, part),
      };
      const best = Math.max(scores.name, scores.brand, scores.supplier, scores.partNumber);
      if (best === 0) { everyTokenMatched = false; continue; }
      total += best;
      for (const [k, v] of Object.entries(scores) as Array<[keyof typeof scores, number]>) {
        if (v === best) matched.add(k);
      }
    }

    if (!everyTokenMatched && wholePart === 0) continue;
    if (wholePart > 0) matched.add("partNumber");
    let score = Math.max(total, wholePart);
    if (name.startsWith(q)) score += 25;
    hits.push({ item, score, matchedOn: [...matched] });
  }

  hits.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  return hits.slice(0, limit);
}

/**
 * Which supplier a delivery is from when the person hasn't said: the
 * supplier they filtered by, else the first item's usual supplier, else its
 * second supplier. Null means "ask them".
 */
export function inferDeliverySupplier(
  chosenSupplierId: number | null,
  firstItem: DeliveryCatalogueItem | null | undefined,
): number | null {
  if (chosenSupplierId != null) return chosenSupplierId;
  return firstItem?.supplierId ?? firstItem?.secondarySupplierId ?? null;
}
