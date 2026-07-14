/**
 * Scrape an ingredient's product page (Brakes, Bidfood, Booker, the
 * supermarkets, etc.) and ask Claude to extract the structured fields
 * the ingredient form needs — brand, pack size, cost per pack, name,
 * supplier part number, allergens, ingredients string, etc.
 *
 * The front-end calls this from the "Scrape" button next to the
 * Ordering URL field in the ingredient form dialog. Result is shown to
 * the operator as a preview panel; they confirm before any of it
 * lands in the actual form state.
 *
 * Security: this is a server-side fetcher, so it's an SSRF vector if
 * left unchecked. We require http(s), block private/loopback/link-local
 * hostnames (the obvious SSRF targets on a typical container), cap the
 * download at 1 MB, and time out after 10 s.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../lib/ai/claude";

const router: IRouter = Router();

const MAX_BYTES = 1_000_000;
const FETCH_TIMEOUT_MS = 10_000;

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

async function fetchPage(url: URL): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        // Many wholesale sites block obvious bot UA strings. A normal
        // browser UA lands the public product page without issues.
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
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
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { combined.set(c, offset); offset += c.byteLength; }
    return new TextDecoder("utf-8").decode(combined);
  } finally {
    clearTimeout(timeout);
  }
}

/** Tear out scripts/styles/SVG and collapse whitespace so we send the
 *  smallest useful payload to Claude. Also pulls a few <meta> tags and
 *  any application/ld+json blocks since those are usually where product
 *  data lives in the modern Shopify / Magento templates these wholesale
 *  sites are built on. */
function distillHtml(html: string): string {
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
  // JSON-LD blocks — usually rich Product schema.
  const ldBlocks: string[] = [];
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ld: RegExpExecArray | null;
  while ((ld = ldRe.exec(html))) ldBlocks.push(ld[1].trim());

  // Title tag (cheap signal).
  const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const titleTag = titleMatch?.[1]?.trim();

  // Strip scripts/styles/svg, then HTML tags, then collapse whitespace.
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const parts: string[] = [];
  if (titleTag) parts.push(`<title>${titleTag}</title>`);
  if (meta.length) parts.push(`<meta>\n${meta.join("\n")}\n</meta>`);
  if (ldBlocks.length) parts.push(`<json-ld>\n${ldBlocks.join("\n---\n")}\n</json-ld>`);
  // Cap the bulk text — Claude doesn't need 200KB of nav and footer.
  parts.push(`<body>\n${stripped.slice(0, 15_000)}\n</body>`);
  return parts.join("\n\n");
}

interface ScrapedFields {
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

router.post("/scrape-url", async (req: Request, res: Response) => {
  if (!isClaudeConfigured()) {
    res.status(503).json({ error: "Scraping requires the Anthropic API key. Ask an admin to set ANTHROPIC_API_KEY." });
    return;
  }
  const rawUrl = String(req.body?.url ?? "").trim();
  if (!rawUrl) { res.status(400).json({ error: "url is required" }); return; }

  const check = isUrlSafe(rawUrl);
  if (!check.ok) { res.status(400).json({ error: check.reason }); return; }

  let html: string;
  try {
    html = await fetchPage(check.url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("aborted")) {
      res.status(504).json({ error: "Page took too long to load (>10s)" });
      return;
    }
    res.status(502).json({ error: `Failed to fetch page: ${msg}` });
    return;
  }

  const distilled = distillHtml(html);

  const client = getClaudeClient();
  let extracted: ScrapedFields;
  try {
    // Use tool_use so we get a typed JSON object back instead of having
    // to parse free-form text. Returns a single tool_use block.
    const response = await client.messages.create({
      model: CLAUDE_MODELS.haiku,
      max_tokens: 1536,
      tool_choice: { type: "tool", name: "extract_ingredient_fields" },
      tools: [{
        name: "extract_ingredient_fields",
        description: "Extract structured ingredient/product data from a product page, including the per-100g nutritional values when present.",
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
      }],
      messages: [{
        role: "user",
        content: `Extract the ingredient fields for the form. Source URL: ${check.url.toString()}

Nutritional values: use the per-100g column on supplier pages (Brakes, Bidfood, supermarkets typically show a Nutrition tab with a table). Leave a nutritional field null if only per-portion values are stated — do NOT back-calculate.

${distilled}`,
      }],
    });

    const toolUse = response.content.find(b => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("Claude did not return a tool_use block");
    }
    extracted = normaliseScrapedFields(toolUse.input);
  } catch (err) {
    console.error("[ingredient-scrape] Claude extraction failed:", err);
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Extraction failed: ${msg}` });
    return;
  }

  res.json({
    url: check.url.toString(),
    extracted,
  });
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
