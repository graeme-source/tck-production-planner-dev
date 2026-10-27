/**
 * Pot labels for sub-recipes we sell as they are — /api/sub-recipe-labels
 * (Graeme, 2026-10-27: the TCK Garlic Mayo label, made by hand in Label
 * LIVE until now). Objectives A, D and F.
 *
 * ONE design: the pots get the PUBLISHED label of the product recipe the
 * sub-recipe is linked to (sub_recipe_product_labels.recipe_id, migration
 * 0281) — for the mayo, recipe 31 "TCK Garlic Mayo 200ml" on the 102 × 25 mm
 * "Garlic mayo" template. Its name, use-by period and barcode are set and
 * checked on that recipe's label page like any other label; here it is only
 * dated (use-by from today, batch = today's Julian YYDDD) and printed. No
 * live label, or a live label the recipe has moved on from = nothing
 * printed, and the done screen says what to do — never a guess.
 *
 *   GET  /                               which sub-recipes have a pot label (ids)
 *   GET  /:subRecipeId                   its label: proof, use-by, pot size — or why not
 *   POST /:subRecipeId/print { count }   print-ready PDF, recorded as a production print
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db, productLabelPrintsTable, usersTable } from "@workspace/db";
import {
  buildPrintRecord, describePeriod, labelFormat, MAX_PRINT_COUNT, PRINT_REFUSAL_TEXT, printRefusal, type LabelSnapshot,
} from "@workspace/product-labels";
import { labelsPdf, proofLabel } from "@workspace/product-labels/render";
import { validate } from "../middleware/validate";
import { londonDateString } from "../lib/london-time";
import { buildCurrentLabel, fonts, loadLiveVersion, loadRecipe } from "../lib/product-labels-store";

const router: IRouter = Router();

type LabelRow = { sub_recipe_id: number; recipe_id: number | null; pot_size_g: string | null; [k: string]: unknown };

/** The pot label as it prints today, or why it can't. */
async function labelFor(subRecipeId: number) {
  const r = await db.execute<LabelRow>(sql`
    SELECT sub_recipe_id, recipe_id, pot_size_g::text AS pot_size_g
      FROM sub_recipe_product_labels WHERE sub_recipe_id = ${subRecipeId}`);
  const row = r.rows[0];
  if (!row) return null;
  const base = {
    subRecipeId: row.sub_recipe_id,
    recipeId: row.recipe_id,
    potSizeG: row.pot_size_g != null ? Number(row.pot_size_g) : null,
    maxCount: MAX_PRINT_COUNT,
  };
  const recipe = row.recipe_id != null ? await loadRecipe(row.recipe_id) : undefined;
  if (!recipe) {
    return { ...base, ready: false as const, recipeName: null, message: "No product label is linked to this sub-recipe yet." };
  }
  const notReady = (message: string) => ({ ...base, ready: false as const, recipeName: recipe.name, message });
  const live = await loadLiveVersion(recipe.id);
  if (!live) return notReady(`Publish the ${recipe.name} label first.`);
  const snapshot = live.snapshot as LabelSnapshot;
  if (labelFormat(snapshot.template).backLabel) {
    return notReady(`The ${recipe.name} label is a back label, not a pot label — pick the small pot label template on its label page and publish it.`);
  }
  const current = await buildCurrentLabel(recipe);
  const today = londonDateString();
  const proof = proofLabel(snapshot, { printDate: today, productionDate: today }, fonts());
  const refusal = printRefusal({ hasLive: true, matchesLive: live.snapshotHash === current.hash, fits: proof.layout.fits && proof.content.problems.length === 0 });
  if (refusal) return notReady(refusal === "update-needed" ? `The ${recipe.name} label has changed since it was published — check it and update the live version first.` : PRINT_REFUSAL_TEXT[refusal]);
  const input = proof.small!.content.input;
  return {
    ...base,
    ready: true as const,
    recipeName: recipe.name,
    name: input.name,
    useBy: input.useBy,
    useByPeriod: snapshot.chilled ? describePeriod(snapshot.chilled) : null,
    batch: input.batch ?? "",
    barcode: input.barcode ?? null,
    versionNo: live.versionNo,
    png: proof.png,
    // For printing and the print record (not sent to the page).
    _proof: proof,
    _live: live,
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
    if (!l.ready) { res.json(l); return; }
    const { _proof, _live, ...out } = l;
    res.json(out);
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
    if (!l.ready) { res.status(409).json({ error: l.message }); return; }
    const proof = l._proof;
    const pdf = labelsPdf({ bitmap: proof.bitmap, dpi: proof.layout.dpi, copies: count, title: `${l.recipeName} - pot labels` });

    // Recorded against the live version, like the back labels (Objective D).
    const userId = req.session.userId ?? null;
    const [u] = userId ? await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)) : [];
    await db.insert(productLabelPrintsTable).values(buildPrintRecord({
      recipe: { id: l._live.recipeId!, name: l.recipeName },
      live: { id: l._live.id, versionNo: l._live.versionNo, snapshotHash: l._live.snapshotHash },
      count,
      dates: proof.dates,
      plan: { planId: null, planItemId: null },
      format: "pdf",
      kind: "production",
      user: { id: userId, name: u?.name ?? null },
    }));

    const safe = l.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${safe}-labels-${proof.dates.batchCode}-x${count}.pdf"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(pdf));
  } catch (err) {
    console.error("[sub-recipe-labels] print:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
