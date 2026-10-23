/**
 * Deterministic reader for Amazon product pages — objective G (product
 * info) and D (allergens). Graeme, 23 Oct 2026: an Amazon scrape of a vanilla
 * extract didn't find the ingredients, though they're on the page.
 *
 * Where Amazon keeps the data (checked on amazon.co.uk grocery pages,
 * 23 Oct 2026 — fixtures in __fixtures__/amazon):
 *   - ingredients: the collapsed "Ingredients" expander inside the
 *     `nutritionalInfoAndIngredients_feature_div` widget
 *     (`#nic-ingredients-content`, allergens as `a-text-bold` spans), with a
 *     copy under "Important information → Ingredients:" (`#important-information`);
 *   - nutrition: the same widget's EU table (`#nic-eu-nutrition-facts-*`),
 *     "Typical values | Per 100g" then label | value rows ("191kJ", "0.1g");
 *   - allergens, brand, weight/volume, ASIN: the product-details key/value
 *     tables (`<th>Allergen Information</th><td>Contains: Celery</td>`);
 *   - price: the first `.a-offscreen` price in `#corePrice_feature_div`.
 *
 * Amazon sometimes answers a server fetch with a robot check instead of the
 * product. `isAmazonBlocked` spots that so the scrape can say so, rather
 * than handing a CAPTCHA page to the AI to invent an answer from.
 *
 * Pure — no network, no DB.
 */
import { detectAllergens, type AllergenCode } from "@workspace/allergens";
import { NUTRIENT_KEYS, decodeEntities, type BrakesParsed, type NutrientKey } from "./brakes-product";

export interface AmazonParsed extends BrakesParsed {
  brand: string | null;
}

export function isAmazonUrl(url: URL): boolean {
  return /(^|\.)amazon\.(co\.uk|com|de|fr|it|es|nl|ie|ca|com\.au)$/i.test(url.hostname);
}

/** ASIN from /dp/XXXXXXXXXX or /gp/product/XXXXXXXXXX. */
export function amazonAsin(url: URL): string | null {
  const m = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?#]|$)/i.exec(url.pathname + "/");
  return m ? m[1].toUpperCase() : null;
}

/** A robot-check / CAPTCHA page rather than a product page. */
export function isAmazonBlocked(html: string): boolean {
  if (/id=["']productTitle["']/.test(html)) return false;
  return /captcha|Type the characters you see|robot check|api-services-support@amazon|Sorry, we just need to make sure you're not a robot/i.test(html);
}

// ── text helpers ────────────────────────────────────────────────────────────

function text(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[‎‏‪-‮]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The HTML from an element with the given id to the end of a reasonable
 *  window (Amazon nests deeply; a full DOM parse isn't needed). */
function sectionById(html: string, id: string, max = 40_000): string | null {
  const i = html.search(new RegExp(`id=["']${id}["']`));
  if (i < 0) return null;
  return html.slice(i, i + max);
}

/** Declaration HTML → text, bold spans (Amazon's allergen emphasis) in CAPITALS. */
function declarationText(html: string): string | null {
  const s = html
    .replace(/<span[^>]*class=["'][^"']*a-text-bold[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, (_m, inner: string) => text(inner).toUpperCase())
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => text(inner).toUpperCase());
  const t = text(s)
    .replace(/\s+([,.;:)])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/[﴾]/g, "(").replace(/[﴿]/g, ")");
  return t && t !== "-" ? t : null;
}

/** Every key/value pair in the product-details tables and detail bullets. */
export function amazonDetails(html: string): Map<string, string> {
  const out = new Map<string, string>();
  const put = (k: string, v: string) => {
    const key = text(k).replace(/[:\s]+$/, "").toLowerCase();
    const val = text(v);
    if (key && val && !out.has(key)) out.set(key, val);
  };
  for (const m of html.matchAll(/<th[^>]*>([\s\S]{1,300}?)<\/th>\s*<td[^>]*>([\s\S]{0,3000}?)<\/td>/gi)) put(m[1], m[2]);
  // Detail-bullets layout: <span class="a-text-bold">Net Quantity ‏ : ‎</span> <span>500 g</span>
  for (const m of html.matchAll(/<span class=["']a-text-bold["']>([^<]{1,80}?)\s*[‎‏]*:\s*[‎‏]*<\/span>\s*<span[^>]*>([\s\S]{0,500}?)<\/span>/gi)) put(m[1], m[2]);
  return out;
}

// ── fields ──────────────────────────────────────────────────────────────────

/** "191kJ" → { kj: 191 }; "191kJ / 45kcal" → both; "0.1g" → 0.1; "-" → null. */
function firstNumber(s: string): number | null {
  const m = /-?\d+(?:[.,]\d+)?/.exec(s);
  if (!m) return null;
  const n = Number(m[0].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function energy(s: string): { kj: number | null; kcal: number | null } {
  const kj = /(\d+(?:[.,]\d+)?)\s*kj/i.exec(s);
  const kcal = /(\d+(?:[.,]\d+)?)\s*kcal/i.exec(s);
  return {
    kj: kj ? Number(kj[1].replace(",", ".")) : null,
    kcal: kcal ? Number(kcal[1].replace(",", ".")) : null,
  };
}

/** Amazon's nutrient labels vary ("Carbohydrates", "Carbohydrate", "of
 *  which saturates", "Fibre"/"Fiber"). Order matters: saturates before fat,
 *  sugars before carbohydrate. */
function nutrientFor(label: string): NutrientKey | "energy" | "sodium" | null {
  const l = label.toLowerCase();
  if (/energy|calories/.test(l)) return "energy";
  if (/saturat/.test(l)) return "saturates";
  if (/\bfat\b/.test(l)) return "fat";
  if (/sugar/.test(l)) return "sugars";
  if (/carbohydrate/.test(l)) return "carbohydrate";
  if (/fibre|fiber/.test(l)) return "fibre";
  if (/protein/.test(l)) return "protein";
  if (/\bsalt\b/.test(l)) return "salt";
  if (/sodium/.test(l)) return "sodium";
  return null;
}

/** The per-100g/ml nutrition table in the nutrition widget. Null values are
 *  nutrients the page doesn't list; a listed 0 is 0. Returns all-null when
 *  there's no table or it isn't per 100g/ml (per-portion is never used). */
export function amazonNutrition(html: string): Record<NutrientKey, number | null> {
  const out = Object.fromEntries(NUTRIENT_KEYS.map(k => [k, null])) as Record<NutrientKey, number | null>;
  const widget = sectionById(html, "nutritionalInfoAndIngredients_feature_div", 60_000);
  if (!widget) return out;
  const header = /id=["']nic-eu-nutrition-facts-typical-values["'][\s\S]*?<\/table>/i.exec(widget);
  if (!header || !/per\s*100\s*(g|ml)/i.test(text(header[0]))) return out;
  const table = /id=["']nic-eu-nutrition-facts-table["']([\s\S]*?)(?:<\/table>\s*<\/td>\s*<\/tr>\s*<\/table>|$)/i.exec(widget);
  if (!table) return out;
  let sodium: number | null = null;
  for (const m of table[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) {
    const label = text(m[1]);
    const value = text(m[2]);
    const key = nutrientFor(label);
    if (!key || !value) continue;
    if (key === "energy") {
      const e = energy(value);
      if (e.kj != null && out.energyKj == null) out.energyKj = e.kj;
      if (e.kcal != null && out.energyKcal == null) out.energyKcal = e.kcal;
      continue;
    }
    const n = firstNumber(value);
    if (n == null) continue;
    if (key === "sodium") { sodium = n; continue; }
    if (out[key] == null) out[key] = n;
  }
  if (out.salt == null && sodium != null) out.salt = Math.round(sodium * 2.5 * 1000) / 1000;
  return out;
}

export function amazonIngredients(html: string): string | null {
  const nic = /id=["']nic-ingredients-content["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);
  if (nic) {
    const t = declarationText(nic[1]);
    if (t) return t;
  }
  const info = sectionById(html, "important-information", 20_000);
  if (info) {
    const m = /Ingredients:?\s*<\/span>([\s\S]*?)(?:<div class=["']a-section content["']|<\/div>)/i.exec(info);
    if (m) {
      const t = declarationText(m[1]);
      if (t) return t;
    }
  }
  return null;
}

/** "118 Millilitres" → 118 ml; "342 Grams" → 342 g; "1.5 Kilograms" → 1.5 kg; "| 118ml" in a title too. */
export function parseAmazonQuantity(raw: string | null | undefined): { packSize: number; packUnit: string } | null {
  if (!raw) return null;
  const m = /(\d+(?:[.,]\d+)?)\s*(kilograms?|kg|grams?|gr?\b|g\b|millilit(?:re|er)s?|ml|centilit(?:re|er)s?|cl|lit(?:re|er)s?|l\b|ltrs?)/i.exec(raw);
  if (!m) return null;
  let qty = Number(m[1].replace(",", "."));
  const u = m[2].toLowerCase();
  let unit: string;
  if (/^k/.test(u)) unit = "kg";
  else if (/^g/.test(u)) unit = "g";
  else if (/^m/.test(u)) unit = "ml";
  else if (/^c/.test(u)) { unit = "ml"; qty *= 10; }
  else unit = "l";
  if (!Number.isFinite(qty) || qty <= 0) return null;
  return { packSize: Math.round(qty * 1000) / 1000, packUnit: unit };
}

function amazonPrice(html: string): number | null {
  const core = sectionById(html, "corePrice_feature_div", 20_000) ?? sectionById(html, "corePriceDisplay_desktop_feature_div", 20_000);
  if (!core) return null;
  const m = /class=["']a-offscreen["']>\s*(?:£|&pound;|\$|€)\s*([\d,]+(?:\.\d+)?)/i.exec(core);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const NONE_STATED = /\bnone\b|no allergens|allergen[- ]free|not contain any/i;

export function parseAmazonProduct(html: string, asinFromUrl: string | null = null): AmazonParsed {
  const details = amazonDetails(html);
  const get = (...keys: string[]) => { for (const k of keys) { const v = details.get(k); if (v) return v; } return null; };

  const titleM = /id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i.exec(html);
  const name = titleM ? text(titleM[1]) || null : null;

  let brand = get("brand", "brand name");
  if (!brand) {
    const by = /id=["']bylineInfo["'][^>]*>([\s\S]*?)<\/a>/i.exec(html);
    const t = by ? text(by[1]) : "";
    const m = /^(?:Brand:\s*(.+)|Visit the (.+?) Store)$/i.exec(t);
    brand = m ? (m[1] ?? m[2]).trim() : null;
  }

  // Allergens: the details row ("Contains: Celery"); "may contain" lines are
  // cross-contact and stay out of the ticks.
  const allergenRow = get("allergen information", "allergens", "allergen info");
  const codes = new Set<AllergenCode>();
  let mayContain: string | null = null;
  if (allergenRow) {
    const [contains, may] = allergenRow.split(/may contain:?/i);
    if (!NONE_STATED.test(contains)) for (const c of detectAllergens(contains.replace(/^contains:?/i, ""))) codes.add(c);
    if (may && may.trim()) mayContain = may.trim().replace(/^[:\s]+/, "");
  }

  const pack = parseAmazonQuantity(get("net quantity", "item volume", "volume", "item weight", "net content volume", "weight"))
    ?? parseAmazonQuantity(name);

  return {
    name,
    brand,
    packSize: pack?.packSize ?? null,
    packUnit: pack?.packUnit ?? null,
    costPerPack: amazonPrice(html),
    supplierPartNumber: get("asin") ?? asinFromUrl,
    ingredients: amazonIngredients(html),
    allergens: [...codes].sort(),
    allergensStated: allergenRow != null,
    mayContain,
    nutrition: amazonNutrition(html),
  };
}
