/**
 * Label history — /api/product-labels/recipes/:id/versions. Objective D
 * (traceable, lawful labels): every publish of a recipe's label, what it
 * looked like and what changed, so a recipe change can be traced to the
 * label that carried it.
 *
 *   GET /recipes/:id/versions                       every version, newest first
 *   GET /recipes/:id/versions/:versionNo/proof      PNG of that version
 *   GET /recipes/:id/versions/:versionNo/pdf        one-page archive PDF,
 *                                                   stamped "ARCHIVE vN — NOT FOR PRINTING"
 *
 * Read-only and open to everyone signed in (labels are). Every publish is
 * already stored in full in product_label_versions (routes/product-labels.ts
 * inserts the frozen snapshot); this only reads it. Proofs are dated the day
 * the version was published (London), so they show the label as it was then.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, productLabelPrintsTable, productLabelVersionsTable } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import {
  archivePdfFilename, archiveStampText, buildLabelHistory, normaliseTemplate, type LabelSnapshot,
} from "@workspace/product-labels";
import { encodePng, labelsPdf, proofLabel, stampTest } from "@workspace/product-labels/render";
import { londonDateString } from "../lib/london-time";
import { fonts, loadRecipe } from "../lib/product-labels-store";

const router: IRouter = Router();

const RecipeParams = z.object({ id: z.coerce.number().int().positive() });
const VersionParams = RecipeParams.extend({ versionNo: z.coerce.number().int().positive() });

function fail(res: Response, err: unknown, where: string) {
  console.error(`[product-label-history] ${where}:`, err);
  res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
}

router.get("/recipes/:id/versions", async (req: Request, res: Response) => {
  const p = RecipeParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }
  try {
    const recipe = await loadRecipe(p.data.id);
    if (!recipe) { res.status(404).json({ error: "Recipe not found" }); return; }
    const versions = await db.select().from(productLabelVersionsTable)
      .where(eq(productLabelVersionsTable.recipeId, recipe.id))
      .orderBy(asc(productLabelVersionsTable.versionNo));
    const prints = versions.length
      ? await db.select({
          labelVersionId: productLabelPrintsTable.labelVersionId, versionNo: productLabelPrintsTable.versionNo,
          count: productLabelPrintsTable.count, kind: productLabelPrintsTable.kind, createdAt: productLabelPrintsTable.createdAt,
        }).from(productLabelPrintsTable).where(eq(productLabelPrintsTable.recipeId, recipe.id))
      : [];
    const history = buildLabelHistory(
      versions.map(v => ({ id: v.id, versionNo: v.versionNo, snapshot: v.snapshot as LabelSnapshot, publishedAt: v.publishedAt, publishedByName: v.publishedByName })),
      prints,
    );
    res.json({
      recipeId: recipe.id,
      recipeName: recipe.name,
      versions: history.map(h => ({ ...h, publishedDay: londonDateString(new Date(h.publishedAt)) })),
    });
  } catch (err) { fail(res, err, "GET /recipes/:id/versions"); }
});

/** One stored version drawn as it was on the day it was published. */
async function renderVersion(req: Request, res: Response) {
  const p = VersionParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid recipe or version" }); return null; }
  const [v] = await db.select().from(productLabelVersionsTable)
    .where(and(eq(productLabelVersionsTable.recipeId, p.data.id), eq(productLabelVersionsTable.versionNo, p.data.versionNo)));
  if (!v) { res.status(404).json({ error: "No such label version" }); return null; }
  const day = londonDateString(v.publishedAt);
  const snapshot = v.snapshot as LabelSnapshot;
  const proof = proofLabel(snapshot, { printDate: day, productionDate: day }, fonts());
  return { v, day, snapshot, proof };
}

router.get("/recipes/:id/versions/:versionNo/proof", async (req: Request, res: Response) => {
  try {
    const r = await renderVersion(req, res);
    if (!r) return;
    res.setHeader("Content-Type", "image/png");
    // A version never changes once published.
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(Buffer.from(encodePng(r.proof.bitmap)));
  } catch (err) { fail(res, err, "GET proof"); }
});

router.get("/recipes/:id/versions/:versionNo/pdf", async (req: Request, res: Response) => {
  try {
    const r = await renderVersion(req, res);
    if (!r) return;
    // Stamped across the label (as test prints are) so an archive copy can
    // never be printed and stuck on a pack by mistake.
    stampTest(r.proof.bitmap, fonts(), archiveStampText(r.v.versionNo));
    const page = normaliseTemplate(r.snapshot.template).page;
    const pdf = labelsPdf({
      bitmap: r.proof.bitmap, dpi: page.dpi, copies: 1,
      title: `ARCHIVE - ${r.v.recipeName} label v${r.v.versionNo} published ${r.day} - NOT FOR PRINTING`,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${archivePdfFilename(r.v.recipeName, r.v.versionNo, r.day)}"`);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(Buffer.from(pdf));
  } catch (err) { fail(res, err, "GET pdf"); }
});

export default router;
