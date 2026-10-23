/**
 * Front name labels — /api/product-front-label (#331, Kerri-Leigh Dovale;
 * approved by Graeme 2026-10-22). Objectives A (a new flavour is label-ready
 * as soon as its recipe exists) and F.
 *
 *   GET  /:recipeId/preview?second=   the label as it will print (PNG), its name
 *   POST /:recipeId                   { count, secondLine? } → print-ready PDF
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
import { FRONT_LABEL_PAGE, FRONT_SECOND_LINE_MAX, MAX_PRINT_COUNT, frontLabelName } from "@workspace/product-labels";
import { labelsPdf, renderFrontLabel } from "@workspace/product-labels/render";
import { validate, validateQuery } from "../middleware/validate";
import { fonts, loadRecipe, loadSettingsRow, settingsFromRow } from "../lib/product-labels-store";

const router: IRouter = Router();

const RecipeParams = z.object({ recipeId: z.coerce.number().int().positive() });
const PreviewQuery = z.object({ second: z.string().max(200).optional() });
const PrintBody = z.object({
  count: z.number().int().min(1).max(MAX_PRINT_COUNT),
  secondLine: z.string().max(200).nullable().optional(),
});

async function nameFor(recipeId: number): Promise<{ id: number; recipeName: string; name: string } | null> {
  const recipe = await loadRecipe(recipeId);
  if (!recipe) return null;
  const settings = settingsFromRow(await loadSettingsRow(recipe.id));
  return { id: recipe.id, recipeName: recipe.name, name: frontLabelName(settings.labelName, recipe.name) };
}

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
