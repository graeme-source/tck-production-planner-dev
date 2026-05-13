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
      max_tokens: 1024,
      tool_choice: { type: "tool", name: "extract_ingredient_fields" },
      tools: [{
        name: "extract_ingredient_fields",
        description: "Extract structured ingredient/product data from a product page.",
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
          },
          required: ["name", "brand", "packSize", "packUnit", "costPerPack", "supplierPartNumber", "ingredients", "allergens", "notes"],
        },
      }],
      messages: [{
        role: "user",
        content: `Extract the ingredient fields for the form. Source URL: ${check.url.toString()}\n\n${distilled}`,
      }],
    });

    const toolUse = response.content.find(b => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("Claude did not return a tool_use block");
    }
    extracted = toolUse.input as ScrapedFields;
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

export default router;
