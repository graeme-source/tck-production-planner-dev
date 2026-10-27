/**
 * Pot labels for sub-recipes we sell as they are — /api/sub-recipe-labels
 * (Graeme, 2026-10-27: the TCK Garlic Mayo label, made by hand in Label
 * LIVE until now). Objectives A and F.
 *
 * At the end of making the sub-recipe on the iPad, the done screen shows the
 * label and prints one per pot: name, USE BY (N days from today), batch
 * (Julian YYDDD of today, as on every TCK label) and the product's barcode.
 * 102 × 25 mm, the same stock and print path as the front name labels.
 *
 *   GET  /                          which sub-recipes have a label (ids)
 *   GET  /:subRecipeId              its label: proof, use-by, pot size
 *   POST /:subRecipeId/print { count }   print-ready PDF
 *
 * Set up per sub-recipe in sub_recipe_product_labels (migration 0272).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { addDays, formatLabelDate, julianBatchCode, MAX_PRINT_COUNT } from "@workspace/product-labels";
import { labelsPdf, renderSmallLabel } from "@workspace/product-labels/render";
import { validate } from "../middleware/validate";
import { londonDateString } from "../lib/london-time";
import { scanQueueBarcodes } from "../lib/barcode-store";
import { fonts } from "../lib/product-labels-store";

const router: IRouter = Router();

type LabelRow = { sub_recipe_id: number; label_name: string; use_by_days: number; barcode_variant_id: string | null; pot_size_g: string | null; [k: string]: unknown };

async function labelFor(subRecipeId: number) {
  const r = await db.execute<LabelRow>(sql`
    SELECT sub_recipe_id, label_name, use_by_days, barcode_variant_id, pot_size_g::text AS pot_size_g
      FROM sub_recipe_product_labels WHERE sub_recipe_id = ${subRecipeId}`);
  const row = r.rows[0];
  if (!row) return null;
  const barcode = row.barcode_variant_id ? (await scanQueueBarcodes([row.barcode_variant_id]))[row.barcode_variant_id] ?? null : null;
  const today = londonDateString();
  const useByIso = addDays(today, row.use_by_days);
  return {
    subRecipeId: row.sub_recipe_id,
    name: row.label_name,
    useByDays: row.use_by_days,
    useByIso,
    useBy: formatLabelDate(useByIso),
    batch: julianBatchCode(today),
    barcode,
    potSizeG: row.pot_size_g != null ? Number(row.pot_size_g) : null,
  };
}

const Params = z.object({ subRecipeId: z.coerce.number().int().positive() });

router.get("/", async (_req: Request, res: Response) => {
  const r = await db.execute<{ sub_recipe_id: number }>(sql`SELECT sub_recipe_id FROM sub_recipe_product_labels`);
  res.json({ subRecipeIds: r.rows.map(x => x.sub_recipe_id) });
});

router.get("/:subRecipeId", async (req: Request, res: Response) => {
  const p = Params.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid sub-recipe id" }); return; }
  try {
    const l = await labelFor(p.data.subRecipeId);
    if (!l) { res.status(404).json({ error: "This sub-recipe has no pot label." }); return; }
    const { png, layout } = renderSmallLabel({ name: l.name, useBy: l.useBy, batch: l.batch, barcode: l.barcode }, fonts());
    res.json({ ...l, png, barcodeProblem: layout.barcodeProblem, maxCount: MAX_PRINT_COUNT });
  } catch (err) {
    console.error("[sub-recipe-labels] get:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

const PrintBody = z.object({ count: z.number().int().min(1).max(MAX_PRINT_COUNT) });

router.post("/:subRecipeId/print", validate(PrintBody), async (req: Request, res: Response) => {
  const p = Params.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid sub-recipe id" }); return; }
  const { count } = req.body as z.infer<typeof PrintBody>;
  try {
    const l = await labelFor(p.data.subRecipeId);
    if (!l) { res.status(404).json({ error: "This sub-recipe has no pot label." }); return; }
    const { bitmap, layout } = renderSmallLabel({ name: l.name, useBy: l.useBy, batch: l.batch, barcode: l.barcode }, fonts());
    const pdf = labelsPdf({ bitmap, dpi: layout.dpi, copies: count, title: `${l.name} labels` });
    const safe = l.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${safe}-labels-x${count}.pdf"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(pdf));
  } catch (err) {
    console.error("[sub-recipe-labels] print:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;

