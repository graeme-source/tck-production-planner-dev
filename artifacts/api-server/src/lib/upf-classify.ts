/**
 * NOVA / UPF classification of ingredients — shared by the batch analyzer
 * (POST /api/upf/analyze), the product-page scrape preview and the automatic
 * classification on every ingredient save (objective G).
 *
 * Graeme, 23 Oct 2026: "Once we've got the ingredient deck, we should always
 * automatically do a UPF analysis and store that against the ingredient."
 * So routes/ingredients.ts calls `autoClassifyForSave` on create and update:
 * whenever a declaration is new or changed (or has never been analysed) the
 * class is worked out and stored with the row. A class a person set by hand
 * (nova_source = 'manual') is never overwritten here — the "Analyze with AI"
 * button (force) is how they choose to replace it.
 *
 * The decision rule and the marker scan are pure and unit-tested; the AI
 * call is the existing classify_ingredients tool, moved here unchanged apart
 * from a longer declaration allowance (long decks put the markers last).
 */
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "./ai/claude";

export interface Classification {
  ingredientId: number;
  isFood: boolean;
  novaClass: number | null;
  markers: string[];
  reasoning: string;
  confidence: "high" | "medium" | "low";
}

const CLASSIFY_TOOL = {
  name: "classify_ingredients",
  description: "Record the NOVA processing classification for each ingredient in the batch.",
  input_schema: {
    type: "object" as const,
    properties: {
      classifications: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ingredientId: { type: "integer", description: "The ingredient id exactly as given in the input list." },
            isFood: { type: "boolean", description: "false for non-food items (cleaning products, packaging, gloves, labels) — they get no NOVA class." },
            novaClass: {
              type: ["integer", "null"],
              enum: [1, 2, 3, 4, null],
              description: "NOVA class: 1 unprocessed/minimally processed; 2 processed culinary ingredient; 3 processed food; 4 ultra-processed (UPF). Null only when isFood is false.",
            },
            markers: {
              type: "array",
              items: { type: "string" },
              description: "For NOVA 4 only: the specific UPF marker ingredients found or expected (e.g. 'glucose-fructose syrup', 'modified maize starch', 'flavourings', 'emulsifier (E471)'). Empty for NOVA 1-3.",
            },
            reasoning: { type: "string", description: "One or two short sentences explaining the classification. Mention when you're judging from the name alone because no label declaration was given." },
            confidence: {
              type: "string",
              enum: ["high", "medium", "low"],
              description: "high = label declaration given or the item is unambiguous (salt, olive oil); medium = typical formulation of a known product type; low = name alone and formulations vary widely (could be NOVA 3 or 4 depending on brand).",
            },
          },
          required: ["ingredientId", "isFood", "novaClass", "markers", "reasoning", "confidence"],
        },
      },
    },
    required: ["classifications"],
  },
};

export const CLASSIFY_GUIDANCE = `You are classifying commercial kitchen ingredients on the NOVA food processing scale for a UK food manufacturer (The Calzone Kitchen) that wants to measure and reduce the UPF content of its products.

NOVA classes:
1 — Unprocessed / minimally processed foods: fresh/frozen/dried vegetables, fruit, herbs, plain meat and poultry, milk, plain yoghurt, eggs, plain flour, dried pasta, water, plain spices.
2 — Processed culinary ingredients: oils, butter, sugar, salt, honey, vinegar, lard, starches (plain corn flour / potato starch).
3 — Processed foods: made by combining class 1 + class 2 with traditional preservation methods — canned vegetables in brine, tomato passata/puree, most traditional cheeses, cured meats made of meat+salt+spices only, bread made of flour/water/salt/yeast, tinned beans in water.
4 — Ultra-processed foods (UPF): industrial formulations, typically identified by ingredients you would not find in a home kitchen: glucose-fructose syrup, maltodextrin, modified starches, hydrogenated fats, protein isolates, flavourings (natural or artificial), flavour enhancers, colours, emulsifiers, sweeteners, thickeners/stabilisers used to engineer texture (when part of an industrial formulation), preservatives beyond traditional salting/canning, anti-caking agents in seasoning blends, smoke flavour.

Judging rules:
- When a label declaration (ingredients list) is provided, judge from it directly: the presence of UPF markers (flavourings, modified starch, glucose syrups, colours, emulsifiers, yeast extract used as flavour enhancer, etc.) => NOVA 4. List the exact markers you found.
- When no declaration is provided, judge from the ingredient name, brand and category as sold to UK catering (Sysco, Brakes, Bidfood etc. own-brand norms). Typical commercial formulations count: e.g. wholesale BBQ sauce or ranch dressing is almost always NOVA 4; plain dried oregano is NOVA 1; a plain hard cheese is NOVA 3.
- Cured continental meats (pepperoni, chorizo, prosciutto): NOVA 4 when they contain preservatives (nitrites), dextrose or flavourings — the wholesale norm — otherwise 3. Without a label, assume the wholesale norm (4) for pepperoni/chorizo at medium confidence; prosciutto (pork+salt) is 3.
- Plain single spices/herbs are 1. Seasoning MIXES with anti-caking agents, flavour enhancers or sugar as a formulation are 4; a simple home-style blend of plain spices is 1.
- Cheese: traditional cheeses (mozzarella, cheddar, feta, gorgonzola, taleggio, parmesan) are 3. Processed cheese products (nacho cheese sauce with stabilisers) are 4.
- Sub-recipe items made in-house appear here only as raw ingredients — classify what is bought, not what is made from it.
- isFood=false for cleaning chemicals, packaging, gloves, labels, stationery and other non-food items; give them novaClass null.
- Water is NOVA 1.

Classify EVERY ingredient in the list, echoing its ingredientId exactly.`;

export interface IngredientRow {
  id: number;
  name: string;
  brand: string | null;
  category: string | null;
  labelDeclaration: string | null;
  novaSource: string | null;
}

export function buildBatchPrompt(rows: IngredientRow[]): string {
  const lines = rows.map(r => {
    const parts = [`id=${r.id} | name: ${r.name.trim()}`];
    if (r.brand?.trim()) parts.push(`brand: ${r.brand.trim()}`);
    if (r.category?.trim()) parts.push(`category: ${r.category.trim()}`);
    if (r.labelDeclaration?.trim()) parts.push(`label declaration: ${r.labelDeclaration.trim().slice(0, 2000)}`);
    return "- " + parts.join(" | ");
  });
  return `${CLASSIFY_GUIDANCE}\n\nIngredients to classify:\n${lines.join("\n")}`;
}

export async function classifyBatch(rows: IngredientRow[]): Promise<Classification[]> {
  const client = getClaudeClient();
  const response = await client.messages.create({
    model: CLAUDE_MODELS.sonnet,
    max_tokens: 8192,
    tool_choice: { type: "tool", name: "classify_ingredients" },
    tools: [CLASSIFY_TOOL],
    messages: [{ role: "user", content: buildBatchPrompt(rows) }],
  });
  const toolUse = response.content.find(b => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("Claude did not return a tool_use block");
  const raw = (toolUse.input as { classifications?: unknown[] }).classifications ?? [];
  const validIds = new Set(rows.map(r => r.id));
  const out: Classification[] = [];
  for (const item of raw) {
    const c = item as Record<string, unknown>;
    const id = Number(c["ingredientId"]);
    if (!validIds.has(id)) continue;
    const novaRaw = c["novaClass"];
    const nova = typeof novaRaw === "number" && novaRaw >= 1 && novaRaw <= 4 ? Math.round(novaRaw) : null;
    const conf = c["confidence"];
    out.push({
      ingredientId: id,
      isFood: c["isFood"] !== false,
      novaClass: c["isFood"] === false ? null : nova,
      markers: Array.isArray(c["markers"]) ? (c["markers"] as unknown[]).map(String).slice(0, 20) : [],
      reasoning: typeof c["reasoning"] === "string" ? c["reasoning"] : "",
      confidence: conf === "high" || conf === "medium" || conf === "low" ? conf : "low",
    });
  }
  return out;
}

// ── Deterministic UPF marker scan ───────────────────────────────────────────
//
// Industrial ingredients and cosmetic additives that mark a NOVA 4 product.
// Used two ways: as hints in the AI prompt, and as the fallback verdict when
// the AI is unavailable (no key, timeout) — a declaration listing any of these
// is NOVA 4 by definition. Generic ingredient vocabulary only, never product
// names. Preservatives, acids and antioxidants on their own are NOT here:
// traditional processed foods (NOVA 3) use them too.
const UPF_MARKER_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "flavourings", re: /\bflavou?r(?:ing|ings)\b|\bnatural flavou?rs?\b|\bsmoke flavou?r/i },
  { label: "flavour enhancer", re: /\bflavou?r enhancers?\b|\bmonosodium glutamate\b|\bdisodium (?:guanylate|inosinate|5'?-ribonucleotides?)\b/i },
  { label: "yeast extract", re: /\byeast extracts?\b/i },
  { label: "emulsifier", re: /\bemulsifiers?\b|\blecithins?\b|\bmono- ?and di-?glycerides\b|\bpolysorbates?\b/i },
  { label: "modified starch", re: /\bmodified (?:\w+ )?starch(?:es)?\b/i },
  { label: "glucose / fructose syrup", re: /\b(?:glucose|fructose|glucose-fructose|corn|invert(?:ed)? sugar) syrups?\b/i },
  { label: "maltodextrin", re: /\bmaltodextrins?\b/i },
  { label: "dextrose", re: /\bdextrose\b/i },
  { label: "dextrin", re: /\bdextrins?\b/i },
  { label: "hydrolysed protein", re: /\bhydroly[sz]ed (?:\w+ )?proteins?\b/i },
  { label: "protein isolate", re: /\bprotein isolates?\b|\bsoya? protein concentrate\b/i },
  { label: "caseinate", re: /\bcaseinates?\b/i },
  { label: "hydrogenated fat", re: /\bhydrogenated\b|\binteresterified\b/i },
  { label: "colours", re: /\bcolou?rs?\b(?!\s*:?\s*(?:may|vary))|\bcaramel colou?r\b/i },
  { label: "sweeteners", re: /\bsweeteners?\b|\baspartame\b|\bsucralose\b|\bacesulfame\b|\bsaccharin\b|\bsteviol\b/i },
  { label: "stabilisers / thickeners", re: /\bstabili[sz]ers?\b|\bthickeners?\b|\bxanthan\b|\bguar gum\b|\bcarrageenan\b/i },
  { label: "anti-foaming agent", re: /\banti-?foaming agents?\b|\bdimethyl ?polysiloxane\b/i },
  { label: "anti-caking agent", re: /\banti-?caking agents?\b/i },
  { label: "glazing agent", re: /\bglazing agents?\b/i },
  { label: "humectant", re: /\bhumectants?\b/i },
  { label: "phosphates", re: /\b(?:di|tri|poly)phosphates?\b/i },
];

/** E-number ranges that are cosmetic additives: colours (E1xx), emulsifiers /
 *  stabilisers / thickeners (E4xx), flavour enhancers (E6xx), sweeteners and
 *  anti-foaming agents (E9xx). */
function eNumberMarkers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\bE ?(\d{3})[a-z]?\b/gi)) {
    const n = Number(m[1]);
    if ((n >= 100 && n < 200) || (n >= 400 && n < 500) || (n >= 600 && n < 700) || (n >= 900 && n < 1000)) {
      out.push(`E${m[1]}`);
    }
  }
  return out;
}

/** UPF markers named in a declaration, in a stable order, de-duplicated. */
export function findUpfMarkers(declaration: string | null | undefined): string[] {
  const text = (declaration ?? "").trim();
  if (!text) return [];
  const found = UPF_MARKER_PATTERNS.filter(p => p.re.test(text)).map(p => p.label);
  return [...new Set([...found, ...eNumberMarkers(text)])];
}

// ── When does a save classify? ──────────────────────────────────────────────

export interface AutoNovaInput {
  /** The declaration this save will store (after wrapping). */
  declaration: string | null | undefined;
  /** What was stored before the save (null for a new ingredient). */
  previousDeclaration: string | null | undefined;
  /** Stored nova_source before the save. */
  novaSource: string | null | undefined;
  /** Stored nova_analyzed_at before the save. */
  novaAnalyzedAt: Date | string | null | undefined;
  /** False for supplies (packaging, cleaning) — never classified. */
  perishable: boolean | null | undefined;
  /** The person picked a NOVA class in this very save. */
  manualThisSave: boolean;
}

/** The rule: classify on save when there is a declaration, the item is food,
 *  nobody set the class by hand (before or in this save), and the declaration
 *  is new/changed or has never been analysed. */
export function shouldAutoClassify(i: AutoNovaInput): boolean {
  const decl = (i.declaration ?? "").trim();
  if (!decl) return false;
  if (i.perishable === false) return false;
  if (i.manualThisSave) return false;
  if (i.novaSource === "manual") return false;
  const changed = decl !== (i.previousDeclaration ?? "").trim();
  return changed || i.novaAnalyzedAt == null;
}

// ── One-ingredient classification with a short-lived cache ─────────────────

export interface NovaResult {
  novaClass: number | null;
  markers: string[];
  reasoning: string;
  confidence: "high" | "medium" | "low";
  /** "ai" = Claude read the declaration; "markers" = AI unavailable, decided
   *  from the marker scan alone. */
  method: "ai" | "markers";
}

export interface ClassifyInput {
  name: string;
  brand?: string | null;
  category?: string | null;
  labelDeclaration: string;
}

/** The scrape preview classifies a declaration, then the save classifies the
 *  same one moments later — this cache makes that one AI call, not two.
 *  Keyed on the declaration text alone: the save may have a tidied name, a
 *  brand or category typed in since the scrape, none of which change what
 *  the declaration says. */
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 300;
const cache = new Map<string, { at: number; result: NovaResult }>();

export function novaCacheKey(i: Pick<ClassifyInput, "labelDeclaration">): string {
  return i.labelDeclaration.trim().replace(/\s+/g, " ").replace(/[\s.,;]+$/, "").toLowerCase();
}

/** Verdict from the marker scan alone: markers → NOVA 4; otherwise unknown. */
export function markerOnlyVerdict(declaration: string): NovaResult | null {
  const markers = findUpfMarkers(declaration);
  if (markers.length === 0) return null;
  return {
    novaClass: 4,
    markers,
    reasoning: `The label declaration lists UPF markers (${markers.join(", ")}).`,
    confidence: "medium",
    method: "markers",
  };
}

const AI_TIMEOUT_MS = 25_000;

/** Classify one ingredient from its declaration. Never throws: an AI failure
 *  falls back to the marker scan, and null means "couldn't decide" (the row
 *  stays unclassified for the batch analyzer to pick up). */
export async function classifyDeclaration(input: ClassifyInput): Promise<NovaResult | null> {
  const decl = input.labelDeclaration.trim();
  if (!decl) return null;
  const key = novaCacheKey(input);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

  let result: NovaResult | null = null;
  if (isClaudeConfigured()) {
    try {
      const hints = findUpfMarkers(decl);
      const row: IngredientRow = {
        id: 1,
        name: input.name || "Unnamed ingredient",
        brand: input.brand ?? null,
        category: input.category ?? null,
        labelDeclaration: hints.length ? `${decl} [marker scan found: ${hints.join(", ")}]` : decl,
        novaSource: null,
      };
      const out = await Promise.race([
        classifyBatch([row]),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("UPF analysis timed out")), AI_TIMEOUT_MS)),
      ]);
      const c = out[0];
      if (c) {
        result = { novaClass: c.novaClass, markers: c.markers, reasoning: c.reasoning, confidence: c.confidence, method: "ai" };
      }
    } catch (err) {
      console.error("[upf] single classification failed — using marker scan:", err instanceof Error ? err.message : err);
    }
  }
  if (!result) result = markerOnlyVerdict(decl);
  if (result && result.method === "ai") {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: Date.now(), result });
  }
  return result;
}

/** The ingredient columns a classification writes. */
export function novaColumns(r: NovaResult, now = new Date()) {
  return {
    novaClass: r.novaClass,
    novaMarkers: r.markers,
    novaReasoning: r.reasoning || null,
    novaConfidence: r.confidence,
    novaSource: "ai",
    novaAnalyzedAt: now,
  };
}
