/**
 * Front name labels — /api/product-front-label (#331, Kerri-Leigh Dovale;
 * approved by Graeme 2026-10-22). Objectives A (a new flavour is label-ready
 * as soon as its recipe exists) and F.
 *
 *   GET  /:recipeId/preview?second=   the label as it will print (PNG), its name
 *   POST /:recipeId                   { count, secondLine? } → print-ready PDF
 *   GET  /default-recipes             recipes whose front label IS this one
 *   PUT  /:recipeId/default           { on } — make it (or stop it being)
 *                                     the product's front label (2026-10-27,
 *                                     migration 0269; managers and admins)
 *
 * 102 × 25 mm: the recipe's label name (or name) in big bold type that
 * shrinks to fit one line, with an optional short second line typed in the
 * dialog (not stored). Same fonts, renderer and PDF as the back labels, so it
 * prints the same way: from this computer through the label printer's normal
 * driver at Actual size. Name only — no stock, order or traceability data, so
 * there's no live-label check and nothing is recorded.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { FRONT_LABEL_PAGE, FRONT_SECOND_LINE_MAX, MAX_PRINT_COUNT } from "@workspace/product-labels";
import { labelsPdf, renderFrontLabel } from "@workspace/product-labels/render";
import { eq } from "drizzle-orm";
import { db, productLabelSettingsTable } from "@workspace/db";
import { validate, validateQuery } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import { fonts, loadRecipe } from "../lib/product-labels-store";
import { frontLabelNameFor, setFrontLabelDefault } from "../lib/product-label-publish";

const router: IRouter = Router();

const RecipeParams = z.object({ recipeId: z.coerce.number().int().positive() });
const PreviewQuery = z.object({ second: z.string().max(200).optional() });
const PrintBody = z.object({
  count: z.number().int().min(1).max(MAX_PRINT_COUNT),
  secondLine: z.string().max(200).nullable().optional(),
});

const DefaultBody = z.object({ on: z.boolean() });

router.get("/default-recipes", async (_req: Request, res: Response) => {
  try {
    const rows = await db.select({ recipeId: productLabelSettingsTable.recipeId })
      .from(productLabelSettingsTable).where(eq(productLabelSettingsTable.frontLabelPrinted, true));
    res.json({ recipeIds: rows.map(r => r.recipeId) });
  } catch (err) {
    console.error("[product-front-label] default-recipes:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.put("/:recipeId/default", requireManagerOrAdmin, validate(DefaultBody), async (req: Request, res: Response) => {
  const p = RecipeParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }
  const { on } = req.body as z.infer<typeof DefaultBody>;
  try {
    if (!(await loadRecipe(p.data.recipeId))) { res.status(404).json({ error: "Recipe not found" }); return; }
    // The one path (also used by "Create Shopify product" on a recipe).
    await setFrontLabelDefault(p.data.recipeId, on);
    res.json({ ok: true, on });
  } catch (err) {
    console.error("[product-front-label] default:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// The name that prints and whether it's the product's front label — shared
// with "Create Shopify product" (lib/product-label-publish.ts).
const nameFor = frontLabelNameFor;

router.get("/:recipeId/preview", validateQuery(PreviewQuery), async (req: Request, res: Response) => {
  const p = RecipeParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }
  const q = res.locals.query as z.infer<typeof PreviewQuery>;
  try {
    const r = await nameFor(p.data.recipeId);
    if (!r) { res.status(404).json({ error: "Recipe not found" }); return; }
    const { png, layout } = renderFrontLabel({ name: r.name, secondLine: q.second ?? null }, fonts());
    res.json({
      recipeId: r.id,
      recipeName: r.recipeName,
      name: r.name,
      isDefault: r.isDefault,
      canPrint: layout.ok,
      png: layout.ok ? png : null,
      labelSize: { widthMm: FRONT_LABEL_PAGE.widthMm, heightMm: FRONT_LABEL_PAGE.heightMm },
      secondLineMax: FRONT_SECOND_LINE_MAX,
      maxCount: MAX_PRINT_COUNT,
    });
  } catch (err) {
    console.error("[product-front-label] preview:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/:recipeId", validate(PrintBody), async (req: Request, res: Response) => {
  const p = RecipeParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }
  const body = req.body as z.infer<typeof PrintBody>;
  try {
    const r = await nameFor(p.data.recipeId);
    if (!r) { res.status(404).json({ error: "Recipe not found" }); return; }
    const { bitmap, layout } = renderFrontLabel({ name: r.name, secondLine: body.secondLine ?? null }, fonts());
    if (!layout.ok) { res.status(409).json({ error: "This recipe has no name to print." }); return; }
    const pdf = labelsPdf({ bitmap, dpi: layout.dpi, copies: body.count, title: `${r.name} - front labels` });
    const safeName = r.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="front-labels-${safeName}-x${body.count}.pdf"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(pdf));
  } catch (err) {
    console.error("[product-front-label] print:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
