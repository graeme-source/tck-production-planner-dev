/**
 * Scrape an ingredient's product page (Brakes, Bidfood, Booker, the
 * supermarkets, etc.) and ask Claude to extract the structured fields
 * the ingredient form needs — brand, pack size, cost per pack, name,
 * supplier part number, allergens, ingredients string, etc.
 *
 * The front-end calls this from the "Scrape" button next to the
 * Ordering URL field in the ingredient form dialog. Since 23 Oct 2026 the
 * URL result fills the form straight away (the operator reviews the form
 * before saving) together with a per-field "parsed / AI / missing" report
 * and a NOVA preview. Brakes pages are read from their product data without
 * any AI (lib/brakes-product.ts); other sites, and any gaps, go to Claude.
 *
 * Security: this is a server-side fetcher, so it's an SSRF vector if
 * left unchecked. We require http(s), block private/loopback/link-local
 * hostnames (the obvious SSRF targets on a typical container), cap the
 * download at 3 MB, and time out after 45 s.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../lib/ai/claude";
import { validate } from "../middleware/validate";
import { detectAllergens, UK14_CODES, type AllergenCode } from "@workspace/allergens";
import {
  NUTRIENT_KEYS, isBrakesUrl, brakesProductCode, brakesProductApiUrl, brakesProductFromHtml,
  parseBrakesProduct, type BrakesParsed, type BrakesProductJson,
} from "../lib/brakes-product";
import { classifyDeclaration, type NovaResult } from "../lib/upf-classify";
import { isAmazonUrl, amazonAsin, isAmazonBlocked, parseAmazonProduct } from "../lib/amazon-product";

const router: IRouter = Router();

// Wholesale sites can be slow and heavy; a scrape that takes 30s but lands
// the full ingredients/allergens/nutrition data beats a fast failure.
const MAX_BYTES = 3_000_000;
const FETCH_TIMEOUT_MS = 45_000;

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /\.local$/i,
  /\.internal$/i,
];

function isUrlSafe(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, reason: "Invalid URL" }; }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Only http:// and https:// URLs are allowed" };
  }
  if (BLOCKED_HOST_PATTERNS.some(p => p.test(url.hostname))) {
    return { ok: false, reason: "Internal / private host blocked" };
  }
  return { ok: true, url };
}

async function fetchPage(url: URL, accept = "text/html,application/xhtml+xml", timeoutMs = FETCH_TIMEOUT_MS): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        // Many wholesale sites block obvious bot UA strings. A normal
        // browser UA lands the public product page without issues.
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": accept,
        "Accept-Language": "en-GB,en;q=0.9",
      },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    // Stream-read with a hard byte cap so a hostile / huge page can't
    // blow up the container's memory.
    const reader = res.body?.getReader();
    if (!reader) return await res.text();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) { reader.cancel().catch(() => undefined); break; }
      chunks.push(value);
    }
    const combined = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
    let offset = 0;
    for (const c of chunks) { combined.set(c, offset); offset += c.byteLength; }
    return new TextDecoder("utf-8").decode(combined);
  } finally {
    clearTimeout(timeout);
  }
}

const DATA_WORDS = /ingredient|nutrition|nutrient|allergen|energy|saturates|kcal/i;
const WINDOW = 4_000;

/** Up to `max` text windows around the data words in a big JSON/script blob.
 *  The old scrape kept only the FIRST 30 KB of each blob — on Brakes the
 *  product data sits ~350 KB into an 800 KB state blob, behind the site
 *  navigation, so the AI never saw it. Windows around the hits find it
 *  wherever it is. */
export function dataWindows(body: string, max = 8): string[] {
  const out: string[] = [];
  const re = new RegExp(DATA_WORDS.source, "gi");
  let lastEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) && out.length < max) {
    const start = Math.max(0, m.index - WINDOW / 4, lastEnd);
    const end = Math.min(body.length, m.index + WINDOW);
    if (end <= start) continue;
    out.push(body.slice(start, end));
    lastEnd = end;
    re.lastIndex = end;
  }
  return out;
}

/** Page text for the AI fallback: the WHOLE visible + collapsed text. Hidden
 *  accordions (`d-none`, `<details>`, aria-hidden tabs) are still in the
 *  HTML, so nothing is filtered by visibility; table cells and rows keep
 *  their structure ("Fat (g) | 17") instead of being run together; and
 *  JSON-LD plus any data-looking script blobs are searched in full. */
export function distillHtml(html: string): string {
  // Capture metadata we want to surface in the prompt.
  const metaPatterns = [
    /<meta[^>]+(?:property|name)=["'](og:title|og:description|product:price:amount|product:brand|product:retailer_part_no)["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](og:title|og:description|product:price:amount|product:brand|product:retailer_part_no)["']/gi,
  ];
  const meta: string[] = [];
  for (const re of metaPatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) meta.push(`${m[1]}: ${m[2]}`);
  }
  const ldBlocks: string[] = [];
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ld: RegExpExecArray | null;
  while ((ld = ldRe.exec(html))) ldBlocks.push(ld[1].trim().slice(0, 20_000));

  const dataBlocks: string[] = [];
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = scriptRe.exec(html)) && dataBlocks.length < 12) {
    const body = sm[1]?.trim();
    if (!body || body.length < 80 || ldBlocks.some(b => body.startsWith(b.slice(0, 200)))) continue;
    if (!DATA_WORDS.test(body)) continue;
    if (body.length <= WINDOW * 2) dataBlocks.push(body);
    else dataBlocks.push(...dataWindows(body, 12 - dataBlocks.length));
  }

  const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const titleTag = titleMatch?.[1]?.trim();

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Keep allergen emphasis visible to the model: <strong>MILK</strong> → MILK
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => inner.replace(/<[^>]+>/g, "").toUpperCase())
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<\/(tr|p|li|h[1-6]|div|section|details|summary|dt|dd)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n[\s|]*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

  const parts: string[] = [];
  if (titleTag) parts.push(`<title>${titleTag}</title>`);
  if (meta.length) parts.push(`<meta>\n${meta.join("\n")}\n</meta>`);
  if (ldBlocks.length) parts.push(`<json-ld>\n${ldBlocks.join("\n---\n")}\n</json-ld>`);
  if (dataBlocks.length) parts.push(`<embedded-data>\n${dataBlocks.join("\n---\n").slice(0, 60_000)}\n</embedded-data>`);
  parts.push(`<page-text>\n${text.slice(0, 120_000)}\n</page-text>`);
  return parts.join("\n\n");
}

export interface ScrapedFields {
  name: string | null;
  brand: string | null;
  packSize: number | null;
  packUnit: string | null;     // kg, g, l, ml, pieces, each, box, bag, tub, roll, sheet
  costPerPack: number | null;  // GBP
  supplierPartNumber: string | null;
  ingredients: string | null;  // raw text, multi-line
  allergens: string[];         // free-form labels Claude finds
  notes: string | null;        // anything useful it picks up that doesn't fit elsewhere
  // Per-100g nutritional values — null when not stated on the page or when
  // only per-portion values are given (we don't try to back-calculate).
  energyKj: number | null;
  energyKcal: number | null;
  fat: number | null;
  saturates: number | null;
  carbohydrate: number | null;
  sugars: number | null;
  protein: number | null;
  fibre: number | null;
  salt: number | null;
}

/** The tool's input_schema asks for numbers, but a model can still hand back
 *  "£12.50", "12.50" or "1,250" — a supplier page shows prices as text, and the
 *  schema is a request, not a guarantee. Previously the tool output was passed
 *  to the client with a bare `as ScrapedFields` cast, so a string price reached
 *  the browser and `costPerPack.toFixed(2)` threw, blanking the whole page.
 *  Coerce every numeric field here instead of trusting the model. */
function toNumberOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    // Strip currency symbols, thousands separators and stray unit text ("£12.50/kg").
    const cleaned = v.replace(/[^0-9.\-]/g, "");
    if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toStringOrNull(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

/** Normalise whatever the model returned into a ScrapedFields the client can
 *  rely on. Never throws — a malformed field becomes null rather than taking
 *  the scrape (or the page) down. */
export function normaliseScrapedFields(raw: unknown): ScrapedFields {
  const r = (raw ?? {}) as Record<string, unknown>;
  const allergens = Array.isArray(r["allergens"])
    ? (r["allergens"] as unknown[]).map(a => toStringOrNull(a)).filter((a): a is string => a !== null)
    : [];
  return {
    name: toStringOrNull(r["name"]),
    brand: toStringOrNull(r["brand"]),
    packSize: toNumberOrNull(r["packSize"]),
    packUnit: toStringOrNull(r["packUnit"]),
    costPerPack: toNumberOrNull(r["costPerPack"]),
    supplierPartNumber: toStringOrNull(r["supplierPartNumber"]),
    ingredients: toStringOrNull(r["ingredients"]),
    allergens,
    notes: toStringOrNull(r["notes"]),
    energyKj: toNumberOrNull(r["energyKj"]),
    energyKcal: toNumberOrNull(r["energyKcal"]),
    fat: toNumberOrNull(r["fat"]),
    saturates: toNumberOrNull(r["saturates"]),
    carbohydrate: toNumberOrNull(r["carbohydrate"]),
    sugars: toNumberOrNull(r["sugars"]),
    protein: toNumberOrNull(r["protein"]),
    fibre: toNumberOrNull(r["fibre"]),
    salt: toNumberOrNull(r["salt"]),
  };
}

/** A UK nutrition declaration only has to list what's present — fibre (and
 *  occasionally others) are simply omitted when there's none to declare. So
 *  when the source clearly has a per-100g nutrition listing (energy plus at
 *  least a few more values), any nutrient it doesn't mention is 0, not
 *  unknown — otherwise the ingredient sits in Data Health flagged as
 *  incomplete forever. No listing at all → everything stays null.
 *
 *  Shared by /scrape-url and /scrape-photo so the two extraction paths can't
 *  drift. Pure — returns a new object, never mutates the input. */

export function applyMissingNutrientZeros(extracted: ScrapedFields): ScrapedFields {
  const present = NUTRIENT_KEYS.filter(k => extracted[k] != null).length;
  const hasEnergy = extracted.energyKj != null || extracted.energyKcal != null;
  if (!hasEnergy || present < 4) return { ...extracted };
  const out = { ...extracted };
  for (const k of NUTRIENT_KEYS) if (out[k] == null) out[k] = 0;
  return out;
}

/** One tool definition shared by /scrape-url and /scrape-photo — both must
 *  hand the client the exact same ScrapedFields shape, so a single const
 *  keeps the two prompts from drifting apart. */
const EXTRACT_INGREDIENT_FIELDS_TOOL: Anthropic.Tool = {
  name: "extract_ingredient_fields",
  description: "Extract structured ingredient/product data from a product page or label, including the per-100g nutritional values when present.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: ["string", "null"], description: "Short product name. Strip brand if it's a separate field. Keep variant info (e.g. 'Plain Flour')." },
      brand: { type: ["string", "null"], description: "Brand / manufacturer (e.g. Caputo, Heinz)." },
      packSize: { type: ["number", "null"], description: "Numeric pack size in the packUnit. e.g. 15 for a 15kg bag." },
      packUnit: { type: ["string", "null"], enum: ["kg", "g", "l", "ml", "pieces", "each", "box", "bag", "tub", "roll", "sheet", null], description: "Native unit." },
      costPerPack: { type: ["number", "null"], description: "Price in GBP for ONE pack at the given pack size. Strip currency symbols." },
      supplierPartNumber: { type: ["string", "null"], description: "SKU / product code / supplier part number." },
      ingredients: { type: ["string", "null"], description: "Ingredient declaration as written on the label." },
      allergens: { type: "array", items: { type: "string" }, description: "Allergen names (e.g. 'wheat', 'eggs'). Empty if none stated." },
      notes: { type: ["string", "null"], description: "Anything useful that doesn't fit the other fields — storage, shelf life hint, certifications. One short line max." },
      energyKj:     { type: ["number", "null"], description: "Energy per 100g/100ml in kJ. Null if only per-portion is shown." },
      energyKcal:   { type: ["number", "null"], description: "Energy per 100g/100ml in kcal. Null if only per-portion is shown." },
      fat:          { type: ["number", "null"], description: "Total fat per 100g/100ml in grams." },
      saturates:    { type: ["number", "null"], description: "Saturated fat (of which saturates) per 100g/100ml in grams." },
      carbohydrate: { type: ["number", "null"], description: "Total carbohydrate per 100g/100ml in grams." },
      sugars:       { type: ["number", "null"], description: "Sugars (of which sugars) per 100g/100ml in grams." },
      protein:      { type: ["number", "null"], description: "Protein per 100g/100ml in grams." },
      fibre:        { type: ["number", "null"], description: "Fibre per 100g/100ml in grams." },
      salt:         { type: ["number", "null"], description: "Salt per 100g/100ml in grams. If only sodium is given, convert to salt by multiplying sodium (g) by 2.5." },
    },
    required: [
      "name", "brand", "packSize", "packUnit", "costPerPack",
      "supplierPartNumber", "ingredients", "allergens", "notes",
      "energyKj", "energyKcal", "fat", "saturates", "carbohydrate",
      "sugars", "protein", "fibre", "salt",
    ],
  },
};

// ── Scrape a product URL: structured parse first, AI only for the gaps ─────
//
// Graeme, 23 Oct 2026: pasting a Brakes URL must ALWAYS bring in the
// nutrition, the ingredient declaration and the allergens, and work out the
// UPF/NOVA class, in one go. Brakes is parsed deterministically
// (lib/brakes-product.ts); the AI only fills what the parse couldn't find, and
// handles every other supplier site. Each field says where it came from.

export type FieldSource = "parsed" | "ai" | "missing";
export const SCRAPE_FIELD_KEYS = [
  "name", "brand", "packSize", "packUnit", "costPerPack", "supplierPartNumber",
  "ingredients", "allergens", ...NUTRIENT_KEYS,
] as const;
export type ScrapeFieldKey = (typeof SCRAPE_FIELD_KEYS)[number];

/** Free-form allergen names (AI output: "Milk", "Wheat", "Sesame seeds") → UK14
 *  codes through the shared keyword engine. Codes pass straight through. */
export function allergenCodesFromNames(names: string[]): AllergenCode[] {
  const out = new Set<AllergenCode>();
  for (const raw of names) {
    const n = raw.trim().toLowerCase();
    if (!n) continue;
    if ((UK14_CODES as readonly string[]).includes(n)) { out.add(n as AllergenCode); continue; }
    if (n === "dairy" || n === "lactose") { out.add("milk"); continue; }
    if (n === "tree nuts") { out.add("nuts"); continue; }
    for (const c of detectAllergens(n.replace(/_/g, " "))) out.add(c);
  }
  return [...out].sort();
}

/** A structured parse (Brakes, Amazon) → the ScrapedFields shape plus where
 *  each field came from. */
export function scrapedFromParsed(p: BrakesParsed & { brand?: string | null }): { fields: ScrapedFields; sources: Record<ScrapeFieldKey, FieldSource> } {
  const fields: ScrapedFields = {
    ...normaliseScrapedFields({}),
    name: p.name,
    brand: p.brand ?? null,
    packSize: p.packSize,
    packUnit: p.packUnit,
    costPerPack: p.costPerPack,
    supplierPartNumber: p.supplierPartNumber,
    ingredients: p.ingredients,
    allergens: p.allergens,
    notes: p.mayContain ? `May contain: ${p.mayContain}` : null,
    ...p.nutrition,
  };
  const sources = {} as Record<ScrapeFieldKey, FieldSource>;
  for (const k of SCRAPE_FIELD_KEYS) {
    if (k === "allergens") sources[k] = p.allergensStated ? "parsed" : "missing";
    else sources[k] = fields[k] != null ? "parsed" : "missing";
  }
  return { fields, sources };
}
export const scrapedFromBrakes = scrapedFromParsed;

/** Thrown when a site answered with a robot check instead of the product. */
export const AMAZON_BLOCKED_MESSAGE = "Amazon blocked the read (it showed a robot check instead of the product). Paste the ingredients into the Label Declaration box instead.";

/** Which fields still need the AI after a structured parse. A Brakes
 *  nutrition table that exists but shows "-" for a nutrient (fibre on cured
 *  meats, say) is the page saying "not declared" — the AI can't know better,
 *  so a partial table does NOT trigger it; only a missing table does. Brand
 *  isn't on Brakes' product data at all, so it never triggers it either. */
export function fieldsNeedingAi(sources: Record<ScrapeFieldKey, FieldSource>): ScrapeFieldKey[] {
  const need: ScrapeFieldKey[] = [];
  for (const k of ["name", "packSize", "costPerPack", "ingredients", "allergens"] as const) {
    if (sources[k] === "missing") need.push(k);
  }
  if (sources.packSize === "missing") need.push("packUnit");
  const anyNutrient = NUTRIENT_KEYS.some(k => sources[k] !== "missing");
  if (!anyNutrient) need.push(...NUTRIENT_KEYS);
  return need;
}

/** Fill only the `need` fields from the AI result; parsed values always win. */
export function mergeAiFields(
  base: ScrapedFields,
  sources: Record<ScrapeFieldKey, FieldSource>,
  ai: ScrapedFields,
  need: readonly ScrapeFieldKey[],
): { fields: ScrapedFields; sources: Record<ScrapeFieldKey, FieldSource> } {
  const fields: ScrapedFields = { ...base };
  const src = { ...sources };
  const set = <K extends keyof ScrapedFields>(k: K, v: ScrapedFields[K]) => { fields[k] = v; };
  for (const k of need) {
    if (k === "allergens") {
      if (ai.allergens.length > 0) { set("allergens", allergenCodesFromNames(ai.allergens)); src.allergens = "ai"; }
      continue;
    }
    const v = ai[k];
    if (v != null) { set(k, v as never); src[k] = "ai"; }
  }
  if (!fields.brand && ai.brand) { fields.brand = ai.brand; src.brand = "ai"; }
  if (!fields.notes && ai.notes) fields.notes = ai.notes;
  return { fields, sources: src };
}

const scrapeUrlBodySchema = z.object({ url: z.string().trim().min(1, "url is required").max(2048) });

async function aiExtractFromHtml(url: URL, html: string): Promise<ScrapedFields> {
  const client = getClaudeClient();
  const response = await client.messages.create({
    model: CLAUDE_MODELS.haiku,
    max_tokens: 2048,
    tool_choice: { type: "tool", name: "extract_ingredient_fields" },
    tools: [EXTRACT_INGREDIENT_FIELDS_TOOL],
    messages: [{
      role: "user",
      content: `Extract the ingredient fields for the form. Source URL: ${url.toString()}

The page text below includes sections that are collapsed or hidden on screen (accordions / tabs such as Ingredients, Allergens, Nutrition) — read all of it. The <embedded-data> section is the page's JSON app state; product data often lives there rather than in the text.

Ingredients: copy the FULL declaration exactly as written, keeping allergen words in CAPITALS (the page bolds them; bold text has been turned into CAPITALS for you).
Nutritional values: per 100g / 100ml only. Leave a nutrient null when the page doesn't state it (a "-" means not stated) or only gives per-portion values — do NOT back-calculate and do NOT fill in 0 for something that isn't printed. A printed 0 is 0.
Allergens: only what the product CONTAINS — never "may contain" / cross-contact lines (put those in notes).

${distillHtml(html)}`,
    }],
  });
  const toolUse = response.content.find(b => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("Claude did not return a tool_use block");
  return normaliseScrapedFields(toolUse.input);
}

router.post("/scrape-url", validate(scrapeUrlBodySchema), async (req: Request, res: Response) => {
  const rawUrl = String((req.body as { url: string }).url).trim();
  const check = isUrlSafe(rawUrl);
  if (!check.ok) { res.status(400).json({ error: check.reason }); return; }
  const url = check.url;

  let fields: ScrapedFields = normaliseScrapedFields({});
  let sources = Object.fromEntries(SCRAPE_FIELD_KEYS.map(k => [k, "missing"])) as Record<ScrapeFieldKey, FieldSource>;
  let method: "brakes-api" | "brakes-page" | "amazon-page" | "ai" | "none" = "none";
  let html: string | null = null;
  const warnings: string[] = [];

  // 1. Brakes: read the product data directly — first the product API the
  //    page itself calls, then the page's embedded state.
  const brakesCode = isBrakesUrl(url) ? brakesProductCode(url) : null;
  if (brakesCode) {
    let product: BrakesProductJson | null = null;
    try {
      const json = JSON.parse(await fetchPage(new URL(brakesProductApiUrl(brakesCode)), "application/json", 20_000)) as BrakesProductJson;
      if (Array.isArray(json.classifications) && json.classifications.length > 0) { product = json; method = "brakes-api"; }
    } catch (err) {
      console.warn(`[ingredient-scrape] Brakes product API failed for ${brakesCode}:`, err instanceof Error ? err.message : err);
    }
    if (!product) {
      try {
        html = await fetchPage(url);
        product = brakesProductFromHtml(html, brakesCode);
        if (product) method = "brakes-page";
      } catch (err) {
        console.warn("[ingredient-scrape] Brakes page fetch failed:", err instanceof Error ? err.message : err);
      }
    }
    if (product) ({ fields, sources } = scrapedFromParsed(parseBrakesProduct(product)));
  }

  // 1b. Amazon: the product page itself, read deterministically. A robot
  //     check is reported as such — never handed to the AI to guess from.
  if (method === "none" && isAmazonUrl(url)) {
    try {
      html = await fetchPage(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(msg.includes("aborted") ? 504 : 502).json({ error: `Couldn't load the Amazon page: ${msg}` });
      return;
    }
    if (isAmazonBlocked(html)) {
      res.status(502).json({ error: AMAZON_BLOCKED_MESSAGE, blocked: true });
      return;
    }
    const parsed = parseAmazonProduct(html, amazonAsin(url));
    if (parsed.name || parsed.ingredients) {
      ({ fields, sources } = scrapedFromParsed(parsed));
      method = "amazon-page";
    }
  }

  // 2. AI for whatever is still missing (everything, on other sites).
  const need = method === "none" ? [...SCRAPE_FIELD_KEYS] : fieldsNeedingAi(sources);
  if (need.length > 0) {
    if (!isClaudeConfigured()) {
      if (method === "none") {
        res.status(503).json({ error: "Scraping this site requires the Anthropic API key. Ask an admin to set ANTHROPIC_API_KEY." });
        return;
      }
      warnings.push("Some fields weren't on the product data and the AI reader isn't set up to look for them.");
    } else {
      try {
        if (html == null) html = await fetchPage(url);
        const ai = await aiExtractFromHtml(url, html);
        ({ fields, sources } = mergeAiFields(fields, sources, ai, need));
        if (method === "none") method = "ai";
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[ingredient-scrape] AI extraction failed:", err);
        if (method === "none") {
          const status = msg.includes("aborted") ? 504 : 502;
          res.status(status).json({ error: status === 504 ? "Page took too long to load (>45s)" : `Couldn't read that page: ${msg}` });
          return;
        }
        warnings.push(`The AI reader couldn't fill the gaps (${msg}).`);
      }
    }
  }

  // 3. One fell swoop: a declaration means a NOVA class straight away. The
  //    same result is reused (cached) when the ingredient is saved, which is
  //    when it's actually stored.
  let upf: NovaResult | null = null;
  if (fields.ingredients) {
    upf = await classifyDeclaration({ name: fields.name ?? "", brand: fields.brand, labelDeclaration: fields.ingredients });
  }

  res.json({ url: url.toString(), method, extracted: fields, sources, upf, warnings });
});

// ── Scrape from photos of the physical label ────────────────────────────────
//
// The operator photographs the pack (front, back, nutrition panel close-up)
// on the iPad and the app fills the same ScrapedFields preview the URL
// scrape uses. The client re-encodes every photo to JPEG ≤2000px before
// upload, so payloads stay well inside the caps below.

const SCRAPE_PHOTO_MAX_IMAGES = 4;
/** Decoded (binary) size cap per image — generous for a 2000px JPEG. */
const SCRAPE_PHOTO_MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** Approximate decoded byte count of a base64 string without decoding it. */
export function base64DecodedBytes(data: string): number {
  const len = data.length;
  if (len === 0) return 0;
  let padding = 0;
  if (data.endsWith("==")) padding = 2;
  else if (data.endsWith("=")) padding = 1;
  return Math.floor((len * 3) / 4) - padding;
}

export const scrapePhotoBodySchema = z.object({
  images: z
    .array(
      z.object({
        /** Base64 image bytes, WITHOUT any `data:image/...;base64,` prefix. */
        data: z
          .string()
          .min(1, "Image data is empty")
          .refine(d => base64DecodedBytes(d) <= SCRAPE_PHOTO_MAX_IMAGE_BYTES, {
            message: "Each photo must be under 4 MB — retake or crop it",
          }),
        mediaType: z.enum(["image/jpeg", "image/png", "image/webp"], {
          message: "Unsupported image type — use JPEG, PNG or WebP",
        }),
      }),
    )
    .min(1, "At least one photo is required")
    .max(SCRAPE_PHOTO_MAX_IMAGES, `At most ${SCRAPE_PHOTO_MAX_IMAGES} photos per read`),
});

router.post("/scrape-photo", async (req: Request, res: Response) => {
  if (!isClaudeConfigured()) {
    res.status(503).json({ error: "Reading labels requires the Anthropic API key. Ask an admin to set ANTHROPIC_API_KEY." });
    return;
  }
  // Direct safeParse rather than the shared validate() middleware: validate()
  // re-builds nested array items through the schema, and this body is nothing
  // BUT a nested array — safeParse keeps the verdict identical with no
  // stripping subtleties (see validate.ts's rawBody note).
  const parsed = scrapePhotoBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: z.flattenError(parsed.error) });
    return;
  }
  const { images } = parsed.data;

  const client = getClaudeClient();
  let extracted: ScrapedFields;
  try {
    const response = await client.messages.create({
      model: CLAUDE_MODELS.haiku,
      max_tokens: 1536,
      tool_choice: { type: "tool", name: "extract_ingredient_fields" },
      tools: [EXTRACT_INGREDIENT_FIELDS_TOOL],
      messages: [{
        role: "user",
        content: [
          ...images.map((img): Anthropic.ImageBlockParam => ({
            type: "image",
            source: { type: "base64", media_type: img.mediaType, data: img.data },
          })),
          {
            type: "text",
            text: `These are photos of a physical UK food product label (front of pack, back of pack and/or a nutrition panel close-up — possibly several angles of the same product). Extract the ingredient fields for the form.

Transcribe the ingredients declaration EXACTLY as printed — preserve the capitalisation the label uses. UK labels print allergens in capitals or bold; keep the capitals as printed.

Nutritional values: per-100g column ONLY. If the panel shows both per-100g and per-portion, use per-100g. If ONLY per-portion values are printed, leave every nutritional field null — do NOT back-calculate. If only sodium is printed, salt = sodium × 2.5.

costPerPack and supplierPartNumber are usually not on a label — null is fine.

If the photos are unreadable/blurry, or aren't a food label at all, return null for every field and put a short explanation in notes.`,
          },
        ],
      }],
    });

    const toolUse = response.content.find(b => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("Claude did not return a tool_use block");
    }
    extracted = normaliseScrapedFields(toolUse.input);
  } catch (err) {
    console.error("[ingredient-scrape] photo extraction failed:", err);
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Extraction failed: ${msg}` });
    return;
  }

  res.json({ extracted: applyMissingNutrientZeros(extracted) });
});

interface EstimatedNutrition {
  energyKj: number | null;
  energyKcal: number | null;
  fat: number | null;
  saturates: number | null;
  carbohydrate: number | null;
  sugars: number | null;
  protein: number | null;
  fibre: number | null;
  salt: number | null;
  allergens: string[];
  confidence: "high" | "medium" | "low";
  notes: string | null;
}

/** Name-only AI estimate of per-100g nutritionals + UK14 allergens for
 *  ingredients with no supplier URL (e.g. "grated mozzarella"). Lower
 *  confidence than scraping a labelled product page — the operator is
 *  expected to verify before relying on the numbers for printed
 *  packaging. The route returns the estimate; the frontend sets the
 *  `nutritionalsAiEstimated` flag on save so the badge can show. */
router.post("/ai-nutrition", async (req: Request, res: Response) => {
  if (!isClaudeConfigured()) {
    res.status(503).json({ error: "AI estimate requires the Anthropic API key. Ask an admin to set ANTHROPIC_API_KEY." });
    return;
  }
  const name = String(req.body?.name ?? "").trim();
  const brand = String(req.body?.brand ?? "").trim();
  const category = String(req.body?.category ?? "").trim();
  if (!name) { res.status(400).json({ error: "name is required" }); return; }

  // Build a compact context block — name first, then brand/category as
  // hints. Brand and category narrow the estimate (e.g. "Galbani" is
  // a specific dairy brand; category=cheese rules out cooked-meat
  // confusion on ambiguous names).
  const contextLines = [`Ingredient name: ${name}`];
  if (brand) contextLines.push(`Brand: ${brand}`);
  if (category) contextLines.push(`Category: ${category}`);
  const context = contextLines.join("\n");

  const client = getClaudeClient();
  let estimate: EstimatedNutrition;
  try {
    const response = await client.messages.create({
      model: CLAUDE_MODELS.haiku,
      max_tokens: 1024,
      tool_choice: { type: "tool", name: "estimate_nutrition" },
      tools: [{
        name: "estimate_nutrition",
        description: "Estimate per-100g nutritional values and UK14 allergens for a generic ingredient from its name alone, with a confidence rating.",
        input_schema: {
          type: "object",
          properties: {
            energyKj:     { type: ["number", "null"], description: "Energy per 100g/100ml in kJ. Typical range 0-3700." },
            energyKcal:   { type: ["number", "null"], description: "Energy per 100g/100ml in kcal. Typical range 0-900." },
            fat:          { type: ["number", "null"], description: "Total fat per 100g/100ml in grams." },
            saturates:    { type: ["number", "null"], description: "Saturated fat per 100g/100ml in grams. Must be ≤ fat." },
            carbohydrate: { type: ["number", "null"], description: "Total carbohydrate per 100g/100ml in grams." },
            sugars:       { type: ["number", "null"], description: "Sugars per 100g/100ml in grams. Must be ≤ carbohydrate." },
            protein:      { type: ["number", "null"], description: "Protein per 100g/100ml in grams." },
            fibre:        { type: ["number", "null"], description: "Fibre per 100g/100ml in grams." },
            salt:         { type: ["number", "null"], description: "Salt per 100g/100ml in grams. NOT sodium." },
            allergens:    {
              type: "array",
              items: { type: "string", enum: [
                "celery", "cereals_containing_gluten", "crustaceans", "eggs",
                "fish", "lupin", "milk", "molluscs", "mustard", "nuts",
                "peanuts", "sesame", "soybeans", "sulphur_dioxide",
              ] },
              description: "UK14 allergen codes definitely present. Be conservative — only include allergens you're certain the ingredient contains. Do NOT include 'may contain' / cross-contamination allergens.",
            },
            confidence: {
              type: "string",
              enum: ["high", "medium", "low"],
              description: "high = generic well-known ingredient (e.g. plain flour, olive oil, grated mozzarella); medium = branded or processed item where you're estimating an average; low = composite/prepared item where you're back-calculating from a guessed recipe.",
            },
            notes: { type: ["string", "null"], description: "One short line on what you assumed (e.g. 'generic full-fat cow's milk mozzarella') or null." },
          },
          required: [
            "energyKj", "energyKcal", "fat", "saturates", "carbohydrate",
            "sugars", "protein", "fibre", "salt", "allergens",
            "confidence", "notes",
          ],
        },
      }],
      messages: [{
        role: "user",
        content: `You are estimating per-100g nutritional values for an ingredient on a food production database. The operator has not supplied a product URL — they want a reasonable estimate from the name alone, which they'll review before saving.

${context}

Give your best estimate of the per-100g nutritional values as they'd appear on a typical supermarket / wholesale supplier label for this ingredient. Use generic values where the brand isn't specified. If the ingredient is too vague to estimate confidently (e.g. just "sauce"), return null for the numeric fields and confidence: "low".

Allergens: only include UK14 allergen codes you're certain are present in this ingredient. For example, mozzarella → milk; soy sauce → soybeans + cereals_containing_gluten (most contain wheat); plain rice → no allergens.

Salt is in grams. If you're thinking in sodium, multiply by 2.5 to get salt.`,
      }],
    });

    const toolUse = response.content.find(b => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("Claude did not return a tool_use block");
    }
    estimate = toolUse.input as EstimatedNutrition;
  } catch (err) {
    console.error("[ingredient-scrape] AI estimate failed:", err);
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Estimate failed: ${msg}` });
    return;
  }

  res.json({ estimate });
});

export default router;
