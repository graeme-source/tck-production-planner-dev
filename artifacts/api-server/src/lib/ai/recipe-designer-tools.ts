import {
  db,
  ingredientsTable,
  recipesTable,
  recipeIngredientsTable,
  recipeSubRecipesTable,
  subRecipesTable,
} from "@workspace/db";
import { eq, ilike, or, asc, inArray } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";
import { computeSubRecipeCosts } from "../sub-recipe-costs";

// ─── Types ─────────────────────────────────────────────────────────────────

interface LineInput {
  ingredientId?: number;
  subRecipeId?: number;
  quantity: number;
}

interface ComputeGpmInput {
  lines: LineInput[];
  packSize: number;
  portionsPerBatch: number;
  packPrice: number;
  packagingCost?: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function num(v: string | number | null | undefined, fallback = 0): number {
  if (v === null || v === undefined) return fallback;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

function ingredientUnitCost(packCost: number, packWeight: number, processingRatio: number | null): number {
  if (packWeight <= 0) return 0;
  const base = packCost / packWeight;
  const ratio = processingRatio && processingRatio > 0 ? processingRatio : 1;
  return base / ratio;
}

// ─── Tool definitions ──────────────────────────────────────────────────────

export const RECIPE_TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "list_recipes",
    description:
      "List all recipes in the production planner. Returns id, name, category, RRP, packSize (portions per pack), portionsPerBatch, and core/special flags. Use to find a recipe id before calling get_recipe.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Optional case-insensitive substring filter on recipe name.",
        },
      },
    },
  },
  {
    name: "get_recipe",
    description:
      "Get full detail for a recipe by id: every ingredient line and sub-recipe line with computed unit cost and line cost, plus totals (ingredient cost per batch, per pack, packaging cost, sell price) and computed GPM% excluding labour. Use this to assess existing recipes against the rubric.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
  },
  {
    name: "search_ingredients",
    description:
      "Search ingredients by name (or list all if no query). Returns id, name, unit, pack weight, pack cost, computed cost-per-unit, processing ratio, supplier, and category. Use to find ingredient ids and current costs when designing a new recipe.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Case-insensitive substring filter on name." },
        limit: { type: "number", description: "Default 30, max 200." },
      },
    },
  },
  {
    name: "get_ingredient_costs",
    description:
      "Bulk lookup of ingredients by id. Returns the same shape as search_ingredients but for a specific list of ids.",
    input_schema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "number" },
        },
      },
      required: ["ids"],
    },
  },
  {
    name: "compute_gpm",
    description:
      "Server-side gross-profit-margin calculation for a hypothetical recipe. Provide ingredient/sub-recipe lines with quantities, the batch yield (portionsPerBatch), the pack size in portions, the pack sell price, and optional packaging cost. Returns ingredient cost per pack and GPM% excluding labour. Use this to validate a draft against the 80% rubric floor before proposing it.",
    input_schema: {
      type: "object",
      properties: {
        lines: {
          type: "array",
          description: "Each line is one ingredient OR one sub-recipe with a quantity (in the recipe/sub-recipe's native unit).",
          items: {
            type: "object",
            properties: {
              ingredientId: { type: "number" },
              subRecipeId: { type: "number" },
              quantity: { type: "number" },
            },
            required: ["quantity"],
          },
        },
        portionsPerBatch: { type: "number" },
        packSize: { type: "number", description: "Portions per pack." },
        packPrice: { type: "number", description: "RRP per pack in £." },
        packagingCost: { type: "number", description: "Optional. £ per pack." },
      },
      required: ["lines", "portionsPerBatch", "packSize", "packPrice"],
    },
  },
];

// ─── Tool implementations ──────────────────────────────────────────────────

async function listRecipes(input: { query?: string }): Promise<unknown> {
  const where = input.query ? ilike(recipesTable.name, `%${input.query}%`) : undefined;
  const rows = await db
    .select({
      id: recipesTable.id,
      name: recipesTable.name,
      category: recipesTable.category,
      rrp: recipesTable.rrp,
      packSize: recipesTable.packSize,
      portionsPerBatch: recipesTable.portionsPerBatch,
      isCoreMenu: recipesTable.isCoreMenu,
      isCurrentSpecial: recipesTable.isCurrentSpecial,
    })
    .from(recipesTable)
    .where(where)
    .orderBy(asc(recipesTable.name));
  return rows.map(r => ({
    ...r,
    rrp: num(r.rrp),
    packSize: num(r.packSize),
  }));
}

async function getRecipe(input: { id: number }): Promise<unknown> {
  const [recipe] = await db.select().from(recipesTable).where(eq(recipesTable.id, input.id));
  if (!recipe) return { error: `Recipe ${input.id} not found` };

  const ingLines = await db
    .select({
      line: recipeIngredientsTable,
      ing: ingredientsTable,
    })
    .from(recipeIngredientsTable)
    .innerJoin(ingredientsTable, eq(ingredientsTable.id, recipeIngredientsTable.ingredientId))
    .where(eq(recipeIngredientsTable.recipeId, input.id));

  const subLines = await db
    .select({
      line: recipeSubRecipesTable,
      sub: subRecipesTable,
    })
    .from(recipeSubRecipesTable)
    .innerJoin(subRecipesTable, eq(subRecipesTable.id, recipeSubRecipesTable.subRecipeId))
    .where(eq(recipeSubRecipesTable.recipeId, input.id));

  const subCosts = subLines.length
    ? await computeSubRecipeCosts(subLines.map(s => s.sub.id))
    : {};

  const ingredientLines = ingLines.map(({ line, ing }) => {
    const unitCost = ingredientUnitCost(num(ing.costPerPack), num(ing.packWeight), num(ing.processingRatio, 1));
    const qty = num(line.quantity);
    return {
      ingredientId: ing.id,
      name: ing.name,
      unit: ing.unit,
      quantity: qty,
      unitCost: round(unitCost, 6),
      lineCost: round(unitCost * qty, 4),
      isTopping: line.isTopping,
      quid: line.quid,
    };
  });

  const subRecipeLines = subLines.map(({ line, sub }) => {
    const unitCost = subCosts[sub.id] ?? 0;
    const qty = num(line.quantity);
    return {
      subRecipeId: sub.id,
      name: sub.name,
      unit: sub.yieldUnit,
      quantity: qty,
      unitCost: round(unitCost, 6),
      lineCost: round(unitCost * qty, 4),
    };
  });

  const ingredientCostPerBatch =
    ingredientLines.reduce((s, l) => s + l.lineCost, 0) +
    subRecipeLines.reduce((s, l) => s + l.lineCost, 0);

  const portionsPerBatch = recipe.portionsPerBatch ?? 1;
  const packSize = num(recipe.packSize, 1);
  const packagingCost = num(recipe.packagingCost);
  const labourCost = num(recipe.labourCost);
  const rrp = num(recipe.rrp);

  const ingredientCostPerPack = portionsPerBatch > 0
    ? (ingredientCostPerBatch * packSize) / portionsPerBatch
    : 0;
  const totalCogsExLabour = ingredientCostPerPack + packagingCost;
  const totalCogsIncLabour = totalCogsExLabour + labourCost;

  const gpmExLabour = rrp > 0 ? ((rrp - totalCogsExLabour) / rrp) * 100 : 0;
  const gpmIncLabour = rrp > 0 ? ((rrp - totalCogsIncLabour) / rrp) * 100 : 0;

  return {
    id: recipe.id,
    name: recipe.name,
    category: recipe.category,
    description: recipe.description,
    notes: recipe.notes,
    portionsPerBatch,
    packSize,
    rrp,
    packagingCost,
    labourCost,
    fillWeightGrams: num(recipe.fillWeightGrams),
    baseType: recipe.baseType,
    baseWeightGrams: num(recipe.baseWeightGrams),
    shelfLifeDays: recipe.shelfLifeDays,
    isCoreMenu: recipe.isCoreMenu,
    isCurrentSpecial: recipe.isCurrentSpecial,
    ingredientLines,
    subRecipeLines,
    totals: {
      ingredientCostPerBatch: round(ingredientCostPerBatch, 4),
      ingredientCostPerPack: round(ingredientCostPerPack, 4),
      packagingCost: round(packagingCost, 4),
      labourCost: round(labourCost, 4),
      totalCogsExLabour: round(totalCogsExLabour, 4),
      totalCogsIncLabour: round(totalCogsIncLabour, 4),
      rrp: round(rrp, 4),
      gpmExLabourPct: round(gpmExLabour, 2),
      gpmIncLabourPct: round(gpmIncLabour, 2),
    },
  };
}

async function searchIngredients(input: { query?: string; limit?: number }): Promise<unknown> {
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 200);
  const where = input.query ? ilike(ingredientsTable.name, `%${input.query}%`) : undefined;
  const rows = await db
    .select()
    .from(ingredientsTable)
    .where(where)
    .orderBy(asc(ingredientsTable.name))
    .limit(limit);
  return rows.map(serializeIngredient);
}

async function getIngredientCosts(input: { ids: number[] }): Promise<unknown> {
  if (!input.ids || input.ids.length === 0) return [];
  const rows = await db
    .select()
    .from(ingredientsTable)
    .where(inArray(ingredientsTable.id, input.ids));
  return rows.map(serializeIngredient);
}

function serializeIngredient(ing: typeof ingredientsTable.$inferSelect) {
  const packWeight = num(ing.packWeight);
  const packCost = num(ing.costPerPack);
  const ratio = num(ing.processingRatio, 1);
  return {
    id: ing.id,
    name: ing.name,
    unit: ing.unit,
    category: ing.category,
    packWeight,
    costPerPack: packCost,
    processingRatio: ratio,
    costPerUnit: round(ingredientUnitCost(packCost, packWeight, ratio), 6),
    brand: ing.brand,
    supplierId: ing.supplierId,
    allergens: ing.allergens,
    perishable: ing.perishable,
    shelfLifeDays: ing.shelfLifeDays,
  };
}

async function computeGpm(input: ComputeGpmInput): Promise<unknown> {
  const ingIds = input.lines.filter(l => l.ingredientId).map(l => l.ingredientId!);
  const subIds = input.lines.filter(l => l.subRecipeId).map(l => l.subRecipeId!);

  const ings = ingIds.length
    ? await db.select().from(ingredientsTable).where(inArray(ingredientsTable.id, ingIds))
    : [];
  const ingMap = new Map(ings.map(i => [i.id, i]));

  const subCosts = subIds.length ? await computeSubRecipeCosts(subIds) : {};

  let costPerBatch = 0;
  const lineDetails: Array<{ ref: string; quantity: number; unitCost: number; lineCost: number; warning?: string }> = [];

  for (const line of input.lines) {
    if (line.ingredientId) {
      const ing = ingMap.get(line.ingredientId);
      if (!ing) {
        lineDetails.push({ ref: `ingredient:${line.ingredientId}`, quantity: line.quantity, unitCost: 0, lineCost: 0, warning: "not found" });
        continue;
      }
      const unitCost = ingredientUnitCost(num(ing.costPerPack), num(ing.packWeight), num(ing.processingRatio, 1));
      const lineCost = unitCost * line.quantity;
      costPerBatch += lineCost;
      lineDetails.push({ ref: `ingredient:${ing.id} ${ing.name}`, quantity: line.quantity, unitCost: round(unitCost, 6), lineCost: round(lineCost, 4) });
    } else if (line.subRecipeId) {
      const unitCost = subCosts[line.subRecipeId] ?? 0;
      const lineCost = unitCost * line.quantity;
      costPerBatch += lineCost;
      lineDetails.push({ ref: `sub_recipe:${line.subRecipeId}`, quantity: line.quantity, unitCost: round(unitCost, 6), lineCost: round(lineCost, 4) });
    } else {
      lineDetails.push({ ref: "(no id)", quantity: line.quantity, unitCost: 0, lineCost: 0, warning: "missing ingredientId or subRecipeId" });
    }
  }

  const portionsPerBatch = input.portionsPerBatch || 1;
  const packSize = input.packSize || 1;
  const packPrice = input.packPrice || 0;
  const packagingCost = input.packagingCost ?? 0;

  const ingredientCostPerPack = (costPerBatch * packSize) / portionsPerBatch;
  const totalCogsExLabour = ingredientCostPerPack + packagingCost;
  const gpmExLabour = packPrice > 0 ? ((packPrice - totalCogsExLabour) / packPrice) * 100 : 0;
  const meetsRubric = gpmExLabour >= 80;

  return {
    lines: lineDetails,
    ingredientCostPerBatch: round(costPerBatch, 4),
    ingredientCostPerPack: round(ingredientCostPerPack, 4),
    packagingCost: round(packagingCost, 4),
    totalCogsExLabour: round(totalCogsExLabour, 4),
    packPrice: round(packPrice, 4),
    gpmExLabourPct: round(gpmExLabour, 2),
    meetsRubricFloor: meetsRubric,
    rubricFloorPct: 80,
  };
}

function round(n: number, decimals: number): number {
  const m = 10 ** decimals;
  return Math.round(n * m) / m;
}

// ─── Dispatcher ────────────────────────────────────────────────────────────

export async function executeRecipeTool(name: string, input: unknown): Promise<{ content: string; isError?: boolean }> {
  try {
    let result: unknown;
    switch (name) {
      case "list_recipes":
        result = await listRecipes((input ?? {}) as { query?: string });
        break;
      case "get_recipe":
        result = await getRecipe(input as { id: number });
        break;
      case "search_ingredients":
        result = await searchIngredients((input ?? {}) as { query?: string; limit?: number });
        break;
      case "get_ingredient_costs":
        result = await getIngredientCosts(input as { ids: number[] });
        break;
      case "compute_gpm":
        result = await computeGpm(input as ComputeGpmInput);
        break;
      default:
        return { content: `Unknown tool: ${name}`, isError: true };
    }
    return { content: JSON.stringify(result) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[recipe-designer] tool ${name} failed:`, err);
    return { content: `Tool ${name} failed: ${msg}`, isError: true };
  }
}

export const RECIPE_TOOL_NAMES = new Set(RECIPE_TOOL_DEFINITIONS.map(t => t.name));

// ─── Proposal tools (handled in route, not here) ───────────────────────────
// These tools are detected by the chat route and trigger SSE events to the
// front-end for the user to confirm. They never write to the DB directly.

export const PROPOSAL_TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "propose_memory_update",
    description:
      "Propose an update to the persistent memory document. The full replacement content is shown to Graeme; he clicks Save to commit it. Until then, memory is unchanged. Use sparingly — only when a meaningful decision, new campaign, or resolved question warrants persistence across sessions.",
    input_schema: {
      type: "object",
      properties: {
        newContent: {
          type: "string",
          description: "Full replacement memory document, in markdown.",
        },
        reason: {
          type: "string",
          description: "One sentence on what changed and why.",
        },
      },
      required: ["newContent", "reason"],
    },
  },
  {
    name: "propose_recipe_draft",
    description:
      "Propose a new recipe to add to the production planner. Does NOT write to the DB. The structured draft is shown to Graeme in a side panel where he can tweak any field, then click Save to commit via the normal recipe-create endpoint. Use real ingredient ids and sub-recipe ids (look them up first via search_ingredients/list_recipes/get_recipe). Always run compute_gpm on the draft first and only propose if it clears 80% GPM ex-labour, OR explicitly note in the reason that you're under floor and want Graeme's call.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        category: { type: "string", description: "e.g. 'Calzone', 'Macaroni Cheese'." },
        notes: { type: "string" },
        servings: { type: "number", description: "Total servings the batch yields. For calzones this is usually portions per batch." },
        servingUnit: { type: "string", description: "e.g. 'portion'." },
        portionsPerBatch: { type: "integer", description: "Default 10." },
        packSize: { type: "number", description: "Portions per pack. Calzones = 2." },
        rrp: { type: "number", description: "Sell price per pack in £." },
        packagingCost: { type: "number", description: "£ per pack." },
        labourCost: { type: "number", description: "£ per pack. Defaults to 0." },
        fillWeightGrams: { type: "number", description: "Filling grams per portion (300–350 typical)." },
        baseType: { type: "string", description: "Existing dough/base name if relevant." },
        baseWeightGrams: { type: "number", description: "Dough grams per portion (115 for calzones)." },
        shelfLifeDays: { type: "integer" },
        isCoreMenu: { type: "boolean" },
        isCurrentSpecial: { type: "boolean" },
        ingredients: {
          type: "array",
          description: "Ingredient lines.",
          items: {
            type: "object",
            properties: {
              ingredientId: { type: "number" },
              quantity: { type: "number" },
              isTopping: { type: "boolean" },
              quid: { type: "boolean", description: "Set true for ingredients that need a QUID % on the label." },
              includeInFillingMix: { type: "boolean" },
            },
            required: ["ingredientId", "quantity"],
          },
        },
        subRecipes: {
          type: "array",
          description: "Sub-recipe lines.",
          items: {
            type: "object",
            properties: {
              subRecipeId: { type: "number" },
              quantity: { type: "number" },
              isTopping: { type: "boolean" },
              includeInFillingMix: { type: "boolean" },
            },
            required: ["subRecipeId", "quantity"],
          },
        },
        rationale: {
          type: "string",
          description: "1–3 sentences: why this design clears the rubric (or where it falls short).",
        },
      },
      required: ["name", "servingUnit", "servings", "rationale"],
    },
  },
];

export const PROPOSAL_TOOL_NAMES = new Set(PROPOSAL_TOOL_DEFINITIONS.map(t => t.name));

export const ALL_TOOL_DEFINITIONS: Anthropic.Tool[] = [
  ...RECIPE_TOOL_DEFINITIONS,
  ...PROPOSAL_TOOL_DEFINITIONS,
];
