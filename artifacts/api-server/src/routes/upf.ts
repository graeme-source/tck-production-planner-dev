/**
 * UPF (ultra-processed food) endpoints.
 *
 *   GET  /api/upf/summary  — live UPF % rollups for every recipe and
 *                            sub-recipe (weight of NOVA-4 ingredients over
 *                            total ingredient weight, resolved through
 *                            nested sub-recipes), plus which ingredients
 *                            still need classification.
 *   POST /api/upf/analyze  — classify ingredients on the NOVA scale with
 *                            Claude (admin/manager only — spends API
 *                            credit). Body: { ingredientIds?: number[],
 *                            force?: boolean }. With no ids it analyzes
 *                            every not-yet-analyzed ingredient that is
 *                            used in a recipe or sub-recipe. Manual
 *                            classifications are never overwritten unless
 *                            force is set.
 *
 * The classification itself is stored on the ingredients table
 * (nova_class 1-4, markers, reasoning, confidence) — see
 * lib/db/migrations/0027_add_upf_nova.sql.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, ingredientsTable, recipeIngredientsTable, subRecipeIngredientsTable, usersTable } from "@workspace/db";
import { eq, inArray, and, isNull } from "drizzle-orm";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../lib/ai/claude";
import { computeUpfSummary } from "../lib/upf";

const router: IRouter = Router();

router.get("/summary", async (_req: Request, res: Response) => {
  try {
    const summary = await computeUpfSummary();
    res.json(summary);
  } catch (err) {
    console.error("[upf] summary failed:", err);
    res.status(500).json({ error: "Failed to compute UPF summary" });
  }
});

// Classification spends Anthropic API credit — managers and admins only.
async function requireAdminOrManager(req: Request, res: Response, next: NextFunction) {
  if (req.session.userRole === "admin" || req.session.userRole === "manager") { next(); return; }
  if (req.session.userId && !req.session.userRole) {
    const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.session.userId));
    if (user) {
      req.session.userRole = user.role as "admin" | "manager" | "viewer";
      if (user.role === "admin" || user.role === "manager") { next(); return; }
    }
  }
  res.status(403).json({ error: "Manager access required" });
}

interface Classification {
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

const CLASSIFY_GUIDANCE = `You are classifying commercial kitchen ingredients on the NOVA food processing scale for a UK food manufacturer (The Calzone Kitchen) that wants to measure and reduce the UPF content of its products.

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

interface IngredientRow {
  id: number;
  name: string;
  brand: string | null;
  category: string | null;
  labelDeclaration: string | null;
  novaSource: string | null;
}

function buildBatchPrompt(rows: IngredientRow[]): string {
  const lines = rows.map(r => {
    const parts = [`id=${r.id} | name: ${r.name.trim()}`];
    if (r.brand?.trim()) parts.push(`brand: ${r.brand.trim()}`);
    if (r.category?.trim()) parts.push(`category: ${r.category.trim()}`);
    if (r.labelDeclaration?.trim()) parts.push(`label declaration: ${r.labelDeclaration.trim().slice(0, 600)}`);
    return "- " + parts.join(" | ");
  });
  return `${CLASSIFY_GUIDANCE}\n\nIngredients to classify:\n${lines.join("\n")}`;
}

async function classifyBatch(rows: IngredientRow[]): Promise<Classification[]> {
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

const BATCH_SIZE = 12;

router.post("/analyze", requireAdminOrManager, async (req: Request, res: Response) => {
  if (!isClaudeConfigured()) {
    res.status(503).json({ error: "UPF analysis requires the Anthropic API key. Ask an admin to set ANTHROPIC_API_KEY." });
    return;
  }

  const idsRaw = req.body?.ingredientIds;
  const force = req.body?.force === true;
  const requestedIds: number[] | null = Array.isArray(idsRaw)
    ? idsRaw.map(Number).filter(n => Number.isInteger(n) && n > 0)
    : null;

  try {
    let rows: IngredientRow[];
    const cols = {
      id: ingredientsTable.id,
      name: ingredientsTable.name,
      brand: ingredientsTable.brand,
      category: ingredientsTable.category,
      labelDeclaration: ingredientsTable.labelDeclaration,
      novaSource: ingredientsTable.novaSource,
    };

    if (requestedIds && requestedIds.length > 0) {
      rows = await db.select(cols).from(ingredientsTable).where(inArray(ingredientsTable.id, requestedIds));
    } else {
      // Default sweep: every ingredient used in a recipe or sub-recipe
      // that hasn't been analyzed yet (or all of them, with force).
      const [recUse, subUse] = await Promise.all([
        db.selectDistinct({ id: recipeIngredientsTable.ingredientId }).from(recipeIngredientsTable),
        db.selectDistinct({ id: subRecipeIngredientsTable.ingredientId }).from(subRecipeIngredientsTable),
      ]);
      const usedIds = [...new Set([...recUse.map(r => r.id), ...subUse.map(s => s.id)])];
      if (usedIds.length === 0) { res.json({ analyzed: 0, results: [] }); return; }
      rows = await db.select(cols).from(ingredientsTable).where(
        force
          ? inArray(ingredientsTable.id, usedIds)
          : and(inArray(ingredientsTable.id, usedIds), isNull(ingredientsTable.novaAnalyzedAt)),
      );
    }

    // Manual classifications stay put unless the caller forces a re-run.
    const targets = rows.filter(r => force || r.novaSource !== "manual");
    if (targets.length === 0) { res.json({ analyzed: 0, results: [] }); return; }

    const batches: IngredientRow[][] = [];
    for (let i = 0; i < targets.length; i += BATCH_SIZE) batches.push(targets.slice(i, i + BATCH_SIZE));

    const results: Classification[] = [];
    const errors: string[] = [];
    // Modest concurrency — enough to make a full sweep quick without
    // hammering rate limits.
    const CONCURRENCY = 3;
    let next = 0;
    async function worker() {
      while (next < batches.length) {
        const batch = batches[next++];
        try {
          results.push(...await classifyBatch(batch));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[upf] batch classification failed:", msg);
          errors.push(msg);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

    const now = new Date();
    for (const c of results) {
      await db.update(ingredientsTable)
        .set({
          novaClass: c.novaClass,
          novaMarkers: c.markers,
          novaReasoning: c.reasoning || (c.isFood ? null : "Not a food item"),
          novaConfidence: c.confidence,
          novaSource: "ai",
          novaAnalyzedAt: now,
        })
        .where(eq(ingredientsTable.id, c.ingredientId));
    }

    res.json({
      analyzed: results.length,
      upfCount: results.filter(r => r.novaClass === 4).length,
      failedBatches: errors.length,
      results,
    });
  } catch (err) {
    console.error("[upf] analyze failed:", err);
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `UPF analysis failed: ${msg}` });
  }
});

export default router;
