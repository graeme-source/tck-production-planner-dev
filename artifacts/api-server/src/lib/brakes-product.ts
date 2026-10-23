/**
 * Deterministic reader for Brakes (brake.co.uk) product pages — objective G
 * (product info) and D (allergens). Graeme, 23 Oct 2026: "always find those
 * ingredients and nutritionals".
 *
 * Why this exists: Brakes is a SAP Commerce / Spartacus (Angular) site. The
 * Ingredients, Allergens and Nutrition sections are collapsed accordions, and
 * the data behind them is a list of "classification features" on the product
 * (codes like `nutrition.fat_per_100`, `ingredientsAndAllergens.ingredients`,
 * `allergens.contains_milk`). The same product JSON reaches us three ways:
 *
 *   1. the public product API the page itself calls
 *      (/occ/v2/brakes/products/{code}?fields=DEFAULT,classifications) — small
 *      clean JSON, works even when the page's server render falls back to an
 *      empty shell;
 *   2. the page's `<script id="ng-state">` transfer-state JSON (~800 KB; the
 *      product sits ~350 KB in, after the site navigation);
 *   3. the server-rendered (but hidden, `d-none`) accordion HTML.
 *
 * The old scrape only gave an AI a whitespace-collapsed text dump of (3) — and
 * its "embedded data" step either skipped the ng-state blob or cut it at 30 KB,
 * long before the product. Reading (1)/(2) directly needs no AI at all.
 *
 * Everything here is pure (no network, no DB) so it is tested against saved
 * copies of real pages in __fixtures__/brakes.
 */
import { detectAllergens, type AllergenCode } from "@workspace/allergens";

export const NUTRIENT_KEYS = [
  "energyKj", "energyKcal", "fat", "saturates", "carbohydrate", "sugars", "protein", "fibre", "salt",
] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

/** Brakes classification feature (suffix after the catalogue prefix) → our
 *  per-100g field. Only the *_per_100 features — per-serve values are never
 *  back-calculated. */
const NUTRIENT_FEATURES: Record<string, NutrientKey> = {
  "nutrition.energy_per_100_kj": "energyKj",
  "nutrition.energy_per_100_kcal": "energyKcal",
  "nutrition.fat_per_100": "fat",
  "nutrition.saturates_per_100": "saturates",
  "nutrition.carbohydrate_per_100": "carbohydrate",
  "nutrition.sugars_per_100": "sugars",
  "nutrition.protein_per_100": "protein",
  "nutrition.fibre_per_100": "fibre",
  "nutrition.salt_equivalent_per_100": "salt",
  "nutrition.salt_per_100": "salt",
};

export interface BrakesParsed {
  name: string | null;
  packSize: number | null;
  packUnit: string | null;
  costPerPack: number | null;
  supplierPartNumber: string | null;
  /** Full declaration, allergen emphasis kept as UPPERCASE. */
  ingredients: string | null;
  /** UK14 codes from the "contains" flags + "Contains:" line (never "may contain"). */
  allergens: AllergenCode[];
  /** True when the page explicitly states the allergen position (incl. "none of the 14"). */
  allergensStated: boolean;
  mayContain: string | null;
  nutrition: Record<NutrientKey, number | null>;
}

// ── URL helpers ─────────────────────────────────────────────────────────────

export function isBrakesUrl(url: URL): boolean {
  const h = url.hostname.toLowerCase();
  return h === "brake.co.uk" || h.endsWith(".brake.co.uk") || h === "brakes.co.uk" || h.endsWith(".brakes.co.uk");
}

/** Product code from a Brakes product URL — the number after `/p/`. */
export function brakesProductCode(url: URL): string | null {
  const m = /\/p\/(\d{3,})(?:[/?#]|$)/.exec(url.pathname + "/");
  return m ? m[1] : null;
}

/** The product API the Brakes page itself calls (seen as a `loopback:` key in
 *  its ng-state). Fixed host — never derived from user input beyond the
 *  numeric code, so it is not an SSRF vector. */
export function brakesProductApiUrl(code: string): string {
  if (!/^\d+$/.test(code)) throw new Error("Brakes product code must be numeric");
  return `https://www.brake.co.uk/occ/v2/brakes/products/${code}?fields=DEFAULT,classifications&lang=en&curr=GBP`;
}

// ── Small value helpers ─────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ent: string) => {
    if (ent[0] === "#") {
      const n = ent[1].toLowerCase() === "x" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[ent.toLowerCase()] ?? whole;
  });
}

/** A Brakes nutrition value → number. "-", "" and anything unreadable are
 *  "not stated" (null); "0" is a real 0. "<0.1" reads as 0.1 (the declared bound). */
export function brakesNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(",", ".");
  if (s === "" || s === "-" || s === "—") return null;
  const m = /-?\d+(?:\.\d+)?/.exec(s);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Declaration HTML → plain text with the allergen emphasis kept as
 *  UPPERCASE (UK FIC: emphasised words are the allergens). */
export function declarationFromHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  let s = String(html);
  s = s.replace(/<(strong|b|em|u)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) =>
    decodeEntities(inner.replace(/<[^>]+>/g, "")).toUpperCase());
  s = s.replace(/<br\s*\/?>/gi, " ").replace(/<\/(p|div|li)>/gi, " ").replace(/<[^>]+>/g, "");
  s = decodeEntities(s)
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:)])/g, "$1")
    .replace(/\(\s+/g, "(")
    .trim();
  if (s === "" || s === "-") return null;
  return s;
}

/** "1 x 1.1ltr" → 1.1 l; "6 x 400g" → 2400 g; "1 x 20ltr" → 20 l; "2 x 2.5kg" → 5 kg. */
export function parseBrakesPackSize(raw: string | null | undefined): { packSize: number; packUnit: string } | null {
  if (!raw) return null;
  const s = String(raw).toLowerCase().replace(/,/g, ".").trim();
  const m = /^(?:(\d+(?:\.\d+)?)\s*x\s*)?(\d+(?:\.\d+)?)\s*(kg|kgs|kilo|g|gm|gr|grams?|ltrs?|litres?|liters?|l|ml|cl)\b/.exec(s);
  if (!m) return null;
  const count = m[1] != null ? Number(m[1]) : 1;
  let qty = Number(m[2]);
  let unit = m[3];
  if (!Number.isFinite(count) || !Number.isFinite(qty) || count <= 0 || qty <= 0) return null;
  if (/^kg|^kilo/.test(unit)) unit = "kg";
  else if (/^g/.test(unit)) unit = "g";
  else if (unit === "ml") unit = "ml";
  else if (unit === "cl") { unit = "ml"; qty *= 10; }
  else unit = "l";
  const total = Math.round(count * qty * 1000) / 1000;
  return { packSize: total, packUnit: unit };
}

// ── Product JSON → fields ───────────────────────────────────────────────────

interface Feature { code?: string; featureValues?: { value?: string }[] }
interface Classification { code?: string; features?: Feature[] }
export interface BrakesProductJson {
  code?: string;
  name?: string;
  packSize?: string;
  price?: { value?: number | string; currencyIso?: string };
  classifications?: Classification[];
}

function featureMap(p: BrakesProductJson): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of p.classifications ?? []) {
    for (const f of c.features ?? []) {
      if (!f.code) continue;
      // "BrakesCCClassification/1.0/nutrition.fat_per_100" → "nutrition.fat_per_100"
      const key = f.code.split("/").pop()!.trim();
      const val = (f.featureValues ?? []).map(v => v.value ?? "").filter(v => v !== "").join(", ");
      if (!out.has(key) || (out.get(key) === "-" && val !== "-")) out.set(key, val);
    }
  }
  return out;
}

const NONE_STATED = /\bnone\b|\bno allergens\b|not contain any/i;

export function parseBrakesProduct(p: BrakesProductJson): BrakesParsed {
  const f = featureMap(p);

  const nutrition = Object.fromEntries(NUTRIENT_KEYS.map(k => [k, null])) as Record<NutrientKey, number | null>;
  for (const [feature, key] of Object.entries(NUTRIENT_FEATURES)) {
    if (nutrition[key] != null) continue;
    const n = brakesNumber(f.get(feature));
    if (n != null) nutrition[key] = n;
  }

  // Allergens: the explicit `allergens.contains_*` flags plus the "Contains:"
  // line, both run through the shared UK14 keyword engine so a flag like
  // `contains_cashew_nuts` or `contains_sesame_seeds` lands on the right code
  // with no supplier-specific table to drift. "May contain" is cross-contact,
  // not an ingredient allergen — kept out of the ticks, reported separately.
  const codes = new Set<AllergenCode>();
  let stated = false;
  for (const [key, val] of f) {
    const m = /^allergens\.contains_(.+)$/.exec(key);
    if (m && /^(true|yes|y|1)$/i.test(val.trim())) {
      stated = true;
      for (const c of detectAllergens(m[1].replace(/_/g, " "))) codes.add(c);
    }
  }
  const containsLine = f.get("ingredientsAndAllergens.allergenscontains");
  if (containsLine && containsLine !== "-") {
    stated = true;
    if (!NONE_STATED.test(containsLine)) for (const c of detectAllergens(containsLine)) codes.add(c);
  }
  const mayRaw = f.get("ingredientsAndAllergens.allergensmaycontain");
  const mayContain = mayRaw && mayRaw !== "-" ? decodeEntities(mayRaw).trim() : null;

  const pack = parseBrakesPackSize(p.packSize);
  const priceRaw = p.price?.value;
  const price = priceRaw == null ? null : Number(priceRaw);

  return {
    name: p.name?.trim() ? decodeEntities(p.name.trim()) : null,
    packSize: pack?.packSize ?? null,
    packUnit: pack?.packUnit ?? null,
    costPerPack: price != null && Number.isFinite(price) && price > 0 ? price : null,
    supplierPartNumber: p.code?.trim() || null,
    ingredients: declarationFromHtml(f.get("ingredientsAndAllergens.ingredients")),
    allergens: [...codes].sort(),
    allergensStated: stated,
    mayContain,
    nutrition,
  };
}

/** Find the Brakes product object inside a page's ng-state JSON. Walks the
 *  tree rather than hard-coding Spartacus's store path (which has moved
 *  between versions): the product is the object with a `classifications`
 *  array, preferring the one whose `code` matches the URL. */
export function brakesProductFromHtml(html: string, code: string | null): BrakesProductJson | null {
  const m = /<script[^>]*id=["']ng-state["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) return null;
  let state: unknown;
  try { state = JSON.parse(m[1]); } catch { return null; }

  let best: BrakesProductJson | null = null;
  const stack: unknown[] = [state];
  let guard = 0;
  while (stack.length && guard++ < 500_000) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) { for (const x of node) stack.push(x); continue; }
    const o = node as Record<string, unknown>;
    if (Array.isArray(o["classifications"]) && (o["classifications"] as unknown[]).length > 0) {
      const p = o as BrakesProductJson;
      if (code && p.code === code) return p;
      if (!best) best = p;
    }
    for (const v of Object.values(o)) if (v && typeof v === "object") stack.push(v);
  }
  return best;
}
