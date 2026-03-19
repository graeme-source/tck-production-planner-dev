import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { QueryResult } from "pg";

type CostRow = { sub_recipe_id: number; total_batch_cost: string; yield_amount: string };
type AncestorRow = { id: number };

/**
 * Drizzle `db.execute()` with node-postgres returns a pg `QueryResult`
 * (with `.rows` property), not a plain array.
 */
function extractRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const qr = result as QueryResult<T>;
  if (qr && Array.isArray(qr.rows)) return qr.rows;
  return [];
}

/**
 * Compute cost-per-yield-unit for each sub-recipe using a PostgreSQL recursive CTE.
 *
 * The CTE propagates ingredient costs bottom-up through the sub-recipe dependency DAG:
 *   - Base case: every sub-recipe contributes its own raw ingredient cost
 *   - Recursive case: each component's cost is multiplied by (quantity / component_yield)
 *     and attributed to the parent sub-recipe
 * Grouping sums all contributions (direct + transitive) per sub-recipe.
 *
 * @param targetIds Optional filter — only return results for these IDs (all computed, then filtered)
 * @returns { [subRecipeId]: costPerYieldUnit }
 */
export async function computeSubRecipeCosts(
  targetIds?: number[]
): Promise<Record<number, number>> {
  const result = await db.execute(sql`
    WITH RECURSIVE
    ingredient_base AS (
      SELECT
        sri.sub_recipe_id,
        COALESCE(
          SUM(
            sri.quantity::numeric
            * i.cost_per_pack::numeric
            / NULLIF(i.pack_weight::numeric, 0)
          ),
          0
        ) AS raw_ingredient_cost
      FROM sub_recipe_ingredients sri
      JOIN ingredients i ON i.id = sri.ingredient_id
      GROUP BY sri.sub_recipe_id
    ),
    cost_traversal AS (
      -- Base: each sub-recipe starts with its own ingredient costs
      SELECT
        sr.id              AS sub_recipe_id,
        sr.yield::numeric  AS yield_amount,
        COALESCE(ib.raw_ingredient_cost, 0) AS total_batch_cost
      FROM sub_recipes sr
      LEFT JOIN ingredient_base ib ON ib.sub_recipe_id = sr.id

      UNION ALL

      -- Recursive: propagate each component's cost contribution to its parent
      SELECT
        srsr.sub_recipe_id,
        parent_sr.yield::numeric,
        ct.total_batch_cost
          * srsr.quantity::numeric
          / NULLIF(ct.yield_amount, 0)
      FROM cost_traversal ct
      JOIN sub_recipe_sub_recipes srsr
        ON srsr.component_sub_recipe_id = ct.sub_recipe_id
      JOIN sub_recipes parent_sr
        ON parent_sr.id = srsr.sub_recipe_id
    )
    SELECT
      sub_recipe_id,
      SUM(total_batch_cost)  AS total_batch_cost,
      MAX(yield_amount)      AS yield_amount
    FROM cost_traversal
    GROUP BY sub_recipe_id
  `);

  const rows = extractRows<CostRow>(result);
  const output: Record<number, number> = {};
  for (const row of rows) {
    const id = Number(row.sub_recipe_id);
    if (targetIds && !targetIds.includes(id)) continue;
    const totalCost = parseFloat(row.total_batch_cost);
    const yieldAmt = parseFloat(row.yield_amount);
    output[id] = yieldAmt > 0 ? totalCost / yieldAmt : 0;
  }
  return output;
}

/**
 * Return the set of sub-recipe IDs that would form a cycle if added
 * as components of `targetId` — i.e., all sub-recipes that (directly or
 * transitively) already depend on `targetId`, plus `targetId` itself.
 *
 * These IDs should be excluded from the available-components picker.
 */
export async function getCyclicIds(targetId: number): Promise<number[]> {
  const result = await db.execute(sql`
    WITH RECURSIVE ancestors AS (
      SELECT sub_recipe_id AS id
      FROM sub_recipe_sub_recipes
      WHERE component_sub_recipe_id = ${targetId}

      UNION

      SELECT srsr.sub_recipe_id
      FROM sub_recipe_sub_recipes srsr
      JOIN ancestors a ON srsr.component_sub_recipe_id = a.id
    )
    SELECT id FROM ancestors
  `);

  const rows = extractRows<AncestorRow>(result);
  return [targetId, ...rows.map(r => Number(r.id))];
}

/**
 * Check whether adding `proposedComponentIds` as components of `targetId`
 * would create a cycle in the sub-recipe dependency graph.
 */
export async function wouldCreateCycle(
  targetId: number,
  proposedComponentIds: number[]
): Promise<boolean> {
  if (proposedComponentIds.length === 0) return false;
  if (proposedComponentIds.includes(targetId)) return true;

  const cyclicIds = await getCyclicIds(targetId);
  return proposedComponentIds.some(id => cyclicIds.includes(id));
}
