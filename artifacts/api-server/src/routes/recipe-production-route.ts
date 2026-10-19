/**
 * A recipe's production route (migration 0202; rules in
 * @workspace/production-schedule recipe-route.ts). Objective A: a product
 * that takes a different path through the kitchen is set up here, not coded.
 *
 *   GET   /recipes/production-routes       every recipe's route, by id — the
 *         small cacheable list the Create Plan screen and the recipe page read
 *   PATCH /recipes/:id/production-route    admin: change any of the flags
 *
 * Mounted ahead of the main recipes router so /production-routes is not
 * taken for a recipe id.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import * as z from "zod";
import { eq } from "drizzle-orm";
import { db, recipesTable } from "@workspace/db";
import { readRecipeRoute } from "@workspace/production-schedule";
import { validate } from "../middleware/validate";
import { requireAdmin } from "../middleware/roles";

const router: IRouter = Router();

const routeColumns = {
  id: recipesTable.id,
  skipOvens: recipesTable.skipOvens,
  defaultStorage: recipesTable.defaultStorage,
  shopifyPushOnWrap: recipesTable.shopifyPushOnWrap,
  excludeFromKpis: recipesTable.excludeFromKpis,
  calzoneBatchEquivalent: recipesTable.calzoneBatchEquivalent,
  billetWeightG: recipesTable.billetWeightG,
};

router.get("/production-routes", async (_req: Request, res: Response) => {
  const rows = await db.select(routeColumns).from(recipesTable);
  res.json(rows.map(r => ({ id: r.id, ...readRecipeRoute(r) })));
});

export const ProductionRouteBody = z.object({
  skipOvens: z.boolean().optional(),
  defaultStorage: z.enum(["fridge", "freezer"]).optional(),
  shopifyPushOnWrap: z.boolean().optional(),
  excludeFromKpis: z.boolean().optional(),
  /** Calzone batches of capacity one batch uses; null = 1 (standard). */
  calzoneBatchEquivalent: z.number().min(0).max(1000).nullable().optional(),
  /** Grams each billet is portioned to (migration 0203); null = dough per batch. */
  billetWeightG: z.number().int().min(1).max(100000).nullable().optional(),
});

router.patch("/:id/production-route", requireAdmin, validate(ProductionRouteBody), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid recipe id" }); return; }
  const body = req.body as z.infer<typeof ProductionRouteBody>;
  const set: Partial<typeof recipesTable.$inferInsert> = {};
  if (body.skipOvens !== undefined) set.skipOvens = body.skipOvens;
  if (body.defaultStorage !== undefined) set.defaultStorage = body.defaultStorage;
  if (body.shopifyPushOnWrap !== undefined) set.shopifyPushOnWrap = body.shopifyPushOnWrap;
  if (body.excludeFromKpis !== undefined) set.excludeFromKpis = body.excludeFromKpis;
  if (body.calzoneBatchEquivalent !== undefined) {
    set.calzoneBatchEquivalent = body.calzoneBatchEquivalent === null ? null : String(Math.round(body.calzoneBatchEquivalent * 1e6) / 1e6);
  }
  if (body.billetWeightG !== undefined) set.billetWeightG = body.billetWeightG;
  if (Object.keys(set).length === 0) { res.status(400).json({ error: "Nothing to change" }); return; }
  const [row] = await db.update(recipesTable).set(set).where(eq(recipesTable.id, id)).returning(routeColumns);
  if (!row) { res.status(404).json({ error: "Recipe not found" }); return; }
  res.json({ id: row.id, ...readRecipeRoute(row) });
});

export default router;
