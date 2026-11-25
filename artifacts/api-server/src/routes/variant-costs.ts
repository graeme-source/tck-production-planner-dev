/**
 * Give a Shopify product with no cost a cost — from Founder → Numbers →
 * Order Analysis → an order's contents (Graeme, 25 Nov 2026). Managers and
 * admins; every write is logged to the console with who did it.
 *
 *   GET  /api/variant-costs/options             recipes (with their Shopify
 *                                               links) and supplies to pick from
 *   GET  /api/variant-costs/:variantId          how it's costed now + Shopify's cost
 *   POST /api/variant-costs/:variantId/recipe   { recipeId, kind: main|f2f|wonky, mappingId?, title }
 *   POST /api/variant-costs/:variantId/supply   { ingredientId, unitsPerPack, costPerPack?, title }
 *   PUT  /api/variant-costs/:variantId/manual   { cost, category: food|packaging, title, alsoShopify }
 *
 * The work is in services/variant-costs.ts; the rules in
 * lib/variant-cost-rules.ts. Objective I.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import { actorOf } from "../lib/barcode-store";
import { VARIANT_ID_RE } from "../lib/variant-cost-rules";
import {
  linkVariantAsRecipe, linkVariantAsSupply, setManualVariantCost, variantCostOptions, variantCostStatus, type Fail,
} from "../services/variant-costs";

const router: IRouter = Router();
router.use(requireManagerOrAdmin);

function variantIdOf(req: Request, res: Response): string | null {
  const v = String(req.params["variantId"] ?? "");
  if (!VARIANT_ID_RE.test(v)) { res.status(400).json({ error: "Not a Shopify variant id" }); return null; }
  return v;
}

const sendFail = (res: Response, f: Fail) => res.status(f.status).json({ error: f.error, reason: f.reason });

router.get("/options", async (_req: Request, res: Response) => {
  try {
    res.json(await variantCostOptions());
  } catch (err) {
    console.error("[variant-costs] options failed:", err);
    res.status(500).json({ error: "Couldn't load the recipes and supplies" });
  }
});

router.get("/:variantId", async (req: Request, res: Response) => {
  const v = variantIdOf(req, res);
  if (!v) return;
  try {
    res.json(await variantCostStatus(v));
  } catch (err) {
    console.error("[variant-costs] status failed:", err);
    res.status(500).json({ error: "Couldn't read this product's cost" });
  }
});

const title = z.string().trim().min(1).max(300);

const recipeBody = z.object({
  recipeId: z.number().int().positive(),
  kind: z.enum(["main", "f2f", "wonky"]),
  mappingId: z.number().int().positive().nullish(),
  title,
});

router.post("/:variantId/recipe", validate(recipeBody), async (req: Request, res: Response) => {
  const v = variantIdOf(req, res);
  if (!v) return;
  const b = req.body as z.infer<typeof recipeBody>;
  try {
    const r = await linkVariantAsRecipe(v, b, await actorOf(req.session.userId));
    if (!r.ok) { sendFail(res, r); return; }
    res.json(r);
  } catch (err) {
    console.error("[variant-costs] recipe link failed:", err);
    res.status(500).json({ error: "Couldn't save the link" });
  }
});

const supplyBody = z.object({
  ingredientId: z.number().int().positive(),
  unitsPerPack: z.number().positive().max(1_000_000),
  costPerPack: z.number().positive().max(100_000).nullish(),
  title,
});

router.post("/:variantId/supply", validate(supplyBody), async (req: Request, res: Response) => {
  const v = variantIdOf(req, res);
  if (!v) return;
  const b = req.body as z.infer<typeof supplyBody>;
  try {
    const r = await linkVariantAsSupply(v, b, await actorOf(req.session.userId));
    if (!r.ok) { sendFail(res, r); return; }
    res.json(r);
  } catch (err) {
    console.error("[variant-costs] supply link failed:", err);
    res.status(500).json({ error: "Couldn't save the link" });
  }
});

const manualBody = z.object({
  cost: z.number().positive().max(10_000),
  category: z.enum(["food", "packaging"]),
  title,
  alsoShopify: z.boolean(),
});

router.put("/:variantId/manual", validate(manualBody), async (req: Request, res: Response) => {
  const v = variantIdOf(req, res);
  if (!v) return;
  const b = req.body as z.infer<typeof manualBody>;
  try {
    const r = await setManualVariantCost(v, b, await actorOf(req.session.userId));
    if (!r.ok) { sendFail(res, r); return; }
    res.json(r);
  } catch (err) {
    console.error("[variant-costs] manual cost failed:", err);
    res.status(500).json({ error: "Couldn't save the cost" });
  }
});

export default router;
