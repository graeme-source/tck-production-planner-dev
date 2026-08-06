import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";
import { londonDateString } from "../london-time";

// Read-only operational tools for Caz — production plans, prep quantities,
// factory numbers. Every tool is tagged with the page key whose permission
// gates it (see CAZ_TOOL_PAGE_KEYS), so Caz never surfaces data a given user
// can't already see in the app. There are deliberately NO tools that touch HR
// / personal data (onboarding, training records, user PII) and NONE that write.

export interface CazToolContext {
  /** Session cookie forwarded on loopback calls so the reused endpoints run
   *  with the SAME auth as the chatting user. */
  cookie: string;
  /** API server port for loopback (process.env.PORT). */
  port: string | undefined;
}

/** Maps every read tool Caz can use (its own + the reused recipe-designer ones)
 *  to the page key that gates it. A user must meet that page's min-role for the
 *  tool to be offered. */
export const CAZ_TOOL_PAGE_KEYS: Record<string, string> = {
  // Reused recipe-designer read tools
  list_recipes: "/recipes",
  get_recipe: "/recipes",
  search_ingredients: "/ingredients",
  get_ingredient_costs: "/ingredients",
  compute_gpm: "/recipes",
  // Caz operational tools
  get_recipe_allergens: "/recipes",
  get_production_plan: "/plans",
  get_prep_requirements: "/plans",
  get_factory_numbers: "/plans",
  get_ingredient_consumption: "/ingredients",
};

export const CAZ_TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "get_recipe_allergens",
    description:
      "The full allergen picture and ingredients declaration for a recipe, walking the ENTIRE ingredient tree including nested sub-recipes (dough, bases, rubs). Returns the aggregated allergens present, the 'may contain' statement, and the ordered ingredients declaration with allergens in bold. This is the correct tool for any allergen question — do not try to piece it together from get_recipe.",
    input_schema: {
      type: "object",
      properties: {
        recipeName: { type: "string", description: "Case-insensitive recipe name (or a distinctive part of it)." },
      },
      required: ["recipeName"],
    },
  },
  {
    name: "get_production_plan",
    description:
      "The production plan for a day: which recipes are being made and how many batches. Defaults to today. Use for 'what are we making today/tomorrow', 'how many batches of X'.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD. Defaults to today (London)." },
      },
    },
  },
  {
    name: "get_prep_requirements",
    description:
      "Prep quantities for the raw-meat / mixing station on a given day's plan: per recipe, the raw meat weight, tray count, and each linked marinade/sauce in grams TOTAL and grams PER TRAY. Use for questions like 'how much BBQ sauce per tray for BBQ Pulled Pork today'. Defaults to today. Optionally filter to one recipe by name.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD. Defaults to today (London)." },
        recipeName: { type: "string", description: "Optional case-insensitive substring to filter to one recipe." },
      },
    },
  },
  {
    name: "get_factory_numbers",
    description:
      "Per-recipe stock position for a day's dispatch: what's in the fridge now, the predicted end-of-day number (fridge + still to wrap − still to fulfil), what's going out, and whether we're short. Defaults to today. Use for 'how much X have we got', 'are we short on anything'.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD. Defaults to today (London)." },
      },
    },
  },
  {
    name: "get_ingredient_consumption",
    description:
      "Average ingredient consumption at DPT-standard production, from the stored DPT ingredient requirements (recipe trees fully expanded, so e.g. passata inside Tomato Base counts). Returns per ingredient: RAW quantity used on an average production day, per week (5 production days), pack size, and packs per week. Use for 'how much X do we get through a week/day', 'what's our usage of X'. These are planned averages at the curated DPT sales mix — not till-measured actuals. Mention the calculatedAt date if it's old.",
    input_schema: {
      type: "object",
      properties: {
        ingredientName: { type: "string", description: "Optional case-insensitive substring filter, e.g. 'passata'. Omit for the top consumers." },
        limit: { type: "number", description: "Max rows when not filtering (default 25, ordered by daily usage)." },
      },
    },
  },
];

export const CAZ_TOOL_NAMES = new Set(CAZ_TOOL_DEFINITIONS.map(t => t.name));

// ─── Loopback helper ─────────────────────────────────────────────────────────

async function loopback<T>(ctx: CazToolContext, path: string): Promise<T | null> {
  if (!ctx.port) return null;
  try {
    const resp = await fetch(`http://127.0.0.1:${ctx.port}${path}`, { headers: { cookie: ctx.cookie } });
    if (!resp.ok) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  }
}

/** Resolve a date (default today) to the plan id we should read. Prefer an
 *  active/prep/building plan; fall back to the most recent plan for the date. */
async function resolvePlanId(date: string): Promise<{ id: number; date: string } | null> {
  const rows = await db.execute<{ id: number }>(sql`
    SELECT id FROM production_plans
    WHERE plan_date = ${date}
    ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'building' THEN 1 WHEN 'prep' THEN 2 ELSE 3 END,
             id DESC
    LIMIT 1
  `);
  const row = (rows.rows ?? rows as unknown as Array<{ id: number }>)[0];
  return row ? { id: Number(row.id), date } : null;
}

// ─── Implementations ─────────────────────────────────────────────────────────

async function getRecipeAllergens(ctx: CazToolContext, input: { recipeName?: string }): Promise<unknown> {
  const name = input.recipeName?.trim();
  if (!name) return { note: "Give a recipe name." };
  const rows = await db.execute<{ id: number; name: string }>(sql`
    SELECT id, name FROM recipes WHERE name ILIKE ${"%" + name + "%"} ORDER BY length(name) ASC LIMIT 1
  `);
  const row = (rows.rows ?? rows as unknown as Array<{ id: number; name: string }>)[0];
  if (!row) return { note: `No recipe matches "${name}".` };

  type DeckResp = {
    deckText: string; allergens: string[]; mayContainStatement: string | null;
    missingDeclarations: string[]; unwrappedDeclarations?: string[];
  };
  const deck = await loopback<DeckResp>(ctx, `/api/recipes/${row.id}/ingredient-deck`);
  if (!deck) return { recipe: row.name, note: "Could not read the ingredient deck for that recipe." };
  return {
    recipe: row.name,
    contains: deck.allergens ?? [],
    mayContain: deck.mayContainStatement ?? null,
    ingredientsDeclaration: deck.deckText ?? "",
    // Surface data-quality gaps so Caz can flag rather than mislead on a
    // safety-critical answer.
    incompleteDeclarations: [...(deck.missingDeclarations ?? []), ...(deck.unwrappedDeclarations ?? [])],
  };
}

async function getProductionPlan(input: { date?: string }): Promise<unknown> {
  const date = input.date || londonDateString();
  const plan = await resolvePlanId(date);
  if (!plan) return { date, plan: null, note: `No production plan exists for ${date}.` };
  const rows = await db.execute<{ recipe: string; category: string | null; batches: number; status: string }>(sql`
    SELECT r.name AS recipe, r.category, ppi.batches_target AS batches, pp.status
    FROM production_plan_items ppi
    JOIN production_plans pp ON pp.id = ppi.plan_id
    JOIN recipes r ON r.id = ppi.recipe_id
    WHERE ppi.plan_id = ${plan.id}
    ORDER BY r.name
  `);
  const items = (rows.rows ?? rows as unknown as Array<{ recipe: string; category: string | null; batches: number; status: string }>);
  return {
    date,
    status: items[0]?.status ?? null,
    recipes: items.map(i => ({ recipe: i.recipe, category: i.category, batches: Number(i.batches) })),
  };
}

async function getPrepRequirements(ctx: CazToolContext, input: { date?: string; recipeName?: string }): Promise<unknown> {
  const date = input.date || londonDateString();
  const plan = await resolvePlanId(date);
  if (!plan) return { date, note: `No production plan exists for ${date}.` };

  type PrepResp = {
    recipes: Array<{
      recipeName: string;
      batchesTarget: number;
      trayCount: number | null;
      ingredients: Array<{ name: string; rawQty: number; unit: string; rawMeatTrayCapacityKg?: number | null }>;
      marinades: Array<{ marinadeIngredientName: string | null; marinadeSubRecipeName: string | null; totalGrams: number }>;
    }>;
  };
  const data = await loopback<PrepResp>(ctx, `/api/production-plans/${plan.id}/prep-requirements-by-recipe?station=prep_meat`);
  if (!data) return { date, note: "Could not read prep requirements for that plan." };

  const filter = input.recipeName?.trim().toLowerCase();
  const recipes = (data.recipes ?? [])
    .filter(r => !filter || r.recipeName.toLowerCase().includes(filter))
    .map(r => {
      const trays = r.trayCount && r.trayCount > 0 ? r.trayCount : null;
      return {
        recipe: r.recipeName,
        batches: r.batchesTarget,
        trays: trays,
        // The per-tray figure is the number the station tablet shows; derive it
        // the same way (totalGrams / trayCount) so Caz quotes exactly that.
        linked: r.marinades.map(m => ({
          item: m.marinadeIngredientName ?? m.marinadeSubRecipeName ?? "Unknown",
          totalGrams: m.totalGrams,
          gramsPerTray: trays ? Math.round(m.totalGrams / trays) : null,
        })),
      };
    });

  return { date, note: recipes.length === 0 ? "No matching raw-meat prep on this plan." : undefined, recipes };
}

async function getFactoryNumbers(ctx: CazToolContext, input: { date?: string }): Promise<unknown> {
  const date = input.date || londonDateString();
  type CalcResp = {
    recipes: Array<{
      recipeName: string; fridgeStock: number; predictedFridgeStock: number;
      dispatch2Qty: number; deficit: number; isCoreMenu: boolean;
    }>;
  };
  const data = await loopback<CalcResp>(ctx, `/api/production-plans/calculate?planDate=${date}`);
  if (!data) return { date, note: "Could not read factory numbers for that date." };
  return {
    date,
    recipes: (data.recipes ?? []).map(r => ({
      recipe: r.recipeName,
      inFridgeNow: r.fridgeStock,
      predictedEndOfDay: r.predictedFridgeStock,
      goingOutNextDispatch: r.dispatch2Qty,
      short: r.deficit > 0 ? r.deficit : 0,
    })),
  };
}

// The stored DPT ingredient consumption figures (dpt_ingredient_requirements):
// each row is the raw quantity an average DPT-mix production day consumes,
// recipe trees fully expanded by recalculateDptRequirements(). Weekly = ×5
// production days (Graeme's convention, 2026-08-06).
const PRODUCTION_DAYS_PER_WEEK = 5;

async function getIngredientConsumption(input: { ingredientName?: string; limit?: number }) {
  const filter = input.ingredientName?.trim();
  const limit = Math.min(Math.max(Math.round(input.limit ?? 25), 1), 100);
  const where = filter ? sql`WHERE i.name ILIKE ${"%" + filter + "%"}` : sql``;
  const rows = await db.execute<{
    name: string; unit: string; daily_qty_raw: string; daily_qty_cooked: string;
    pack_weight: string | null; cost_per_pack: string | null; calculated_at: Date;
  }>(sql`
    SELECT i.name, r.unit, r.daily_qty_raw, r.daily_qty_cooked,
           i.pack_weight, i.cost_per_pack, r.calculated_at
    FROM dpt_ingredient_requirements r
    JOIN ingredients i ON i.id = r.ingredient_id
    ${where}
    ORDER BY r.daily_qty_raw DESC
    LIMIT ${limit}
  `);
  const items = (rows.rows as any[]).map(r => {
    const daily = Number(r.daily_qty_raw) || 0;
    const weekly = daily * PRODUCTION_DAYS_PER_WEEK;
    const packWeight = Number(r.pack_weight) || 0;
    const costPerPack = Number(r.cost_per_pack) || 0;
    return {
      ingredient: r.name,
      unit: r.unit,
      rawPerDay: Math.round(daily * 100) / 100,
      rawPerWeek: Math.round(weekly * 100) / 100,
      packWeight: packWeight > 0 ? packWeight : null,
      packsPerWeek: packWeight > 0 ? Math.round((weekly / packWeight) * 10) / 10 : null,
      costPerWeek: packWeight > 0 && costPerPack > 0 ? Math.round((weekly / packWeight) * costPerPack * 100) / 100 : null,
      calculatedAt: r.calculated_at,
    };
  });
  return {
    basis: `Average DPT-mix production day, weekly = ${PRODUCTION_DAYS_PER_WEEK} production days. Planned averages, not till actuals.`,
    matched: items.length,
    items,
  };
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

export async function executeCazTool(name: string, input: unknown, ctx: CazToolContext): Promise<{ content: string; isError?: boolean }> {
  try {
    let result: unknown;
    switch (name) {
      case "get_recipe_allergens":
        result = await getRecipeAllergens(ctx, (input ?? {}) as { recipeName?: string });
        break;
      case "get_production_plan":
        result = await getProductionPlan((input ?? {}) as { date?: string });
        break;
      case "get_prep_requirements":
        result = await getPrepRequirements(ctx, (input ?? {}) as { date?: string; recipeName?: string });
        break;
      case "get_factory_numbers":
        result = await getFactoryNumbers(ctx, (input ?? {}) as { date?: string });
        break;
      case "get_ingredient_consumption":
        result = await getIngredientConsumption((input ?? {}) as { ingredientName?: string; limit?: number });
        break;
      default:
        return { content: `Unknown tool: ${name}`, isError: true };
    }
    return { content: JSON.stringify(result) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[caz] tool ${name} failed:`, err);
    return { content: `Tool ${name} failed: ${msg}`, isError: true };
  }
}
