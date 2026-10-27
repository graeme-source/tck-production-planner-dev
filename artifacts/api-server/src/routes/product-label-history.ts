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
 * Read-only and open to everyone signed in (labels are).
 *
 * The picture is the EXACT image stored when the version went live
 * (product_label_versions.proof_png, migration 0172 — written by the publish
 * route), so later layout-code changes never alter an old version. Only a
 * version with no stored image (published before 0172 and not backfilled by
 * scripts/backfill-label-version-proofs.ts) is re-drawn from its saved
 * snapshot, dated the day it was published — and the list says so
 * (proofSource "redrawn") so the page can tell people.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, productLabelPrintsTable, productLabelVersionsTable } from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  archiveImage, archivePdfFilename, archiveStampText, buildLabelHistory, normaliseTemplate, type LabelSnapshot,
} from "@workspace/product-labels";
import { encodePng, labelsPdf, proofLabel, stampTest } from "@workspace/product-labels/render";
import { londonDateString } from "../lib/london-time";
import { fonts, loadRecipe } from "../lib/product-labels-store";

const router: IRouter = Router();

const RecipeParams = z.object({ id: z.coerce.number().int().positive() });
const VersionParams = RecipeParams.extend({ versionNo: z.coerce.number().int().positive() });
// Which of the recipe's labels (label-roles.ts, migration 0310): each role
// has its own version numbers. None = the main label, as before.
const RoleQuery = z.object({ role: z.enum(["main", "wrapping"]).optional() });
const roleOf = (req: Request) => RoleQuery.safeParse(req.query).data?.role ?? "main";

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
    // Everything but the stored image itself (~100 KB a version).
    const versions = await db.select({
      id: productLabelVersionsTable.id,
      versionNo: productLabelVersionsTable.versionNo,
      snapshot: productLabelVersionsTable.snapshot,
      publishedAt: productLabelVersionsTable.publishedAt,
      publishedByName: productLabelVersionsTable.publishedByName,
      hasStoredProof: sql<boolean>`${productLabelVersionsTable.proofPng} IS NOT NULL`,
    }).from(productLabelVersionsTable)
      .where(and(eq(productLabelVersionsTable.recipeId, recipe.id), eq(productLabelVersionsTable.role, roleOf(req))))
      .orderBy(asc(productLabelVersionsTable.versionNo));
    // Only this label's prints: another role's version numbers overlap.
    const ids = new Set(versions.map(v => v.id));
    const prints = versions.length
      ? (await db.select({
          labelVersionId: productLabelPrintsTable.labelVersionId, versionNo: productLabelPrintsTable.versionNo,
          count: productLabelPrintsTable.count, kind: productLabelPrintsTable.kind, createdAt: productLabelPrintsTable.createdAt,
        }).from(productLabelPrintsTable).where(eq(productLabelPrintsTable.recipeId, recipe.id)))
          .filter(pr => pr.labelVersionId == null || ids.has(pr.labelVersionId))
      : [];
    const stored = new Map(versions.map(v => [v.id, v.hasStoredProof === true]));
    const history = buildLabelHistory(
      versions.map(v => ({ id: v.id, versionNo: v.versionNo, snapshot: v.snapshot as LabelSnapshot, publishedAt: v.publishedAt, publishedByName: v.publishedByName })),
      prints,
    );
    res.json({
      recipeId: recipe.id,
      recipeName: recipe.name,
      versions: history.map(h => ({
        ...h,
        publishedDay: londonDateString(new Date(h.publishedAt)),
        proofSource: stored.get(h.id) ? "stored" : "redrawn",
      })),
    });
  } catch (err) { fail(res, err, "GET /recipes/:id/versions"); }
});

/** One version's picture: the stored image, or a re-draw of its snapshot
 *  dated the day it was published when none was stored. */
async function versionImage(req: Request, res: Response) {
  const p = VersionParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid recipe or version" }); return null; }
  const [v] = await db.select().from(productLabelVersionsTable)
    .where(and(eq(productLabelVersionsTable.recipeId, p.data.id), eq(productLabelVersionsTable.role, roleOf(req)), eq(productLabelVersionsTable.versionNo, p.data.versionNo)));
  if (!v) { res.status(404).json({ error: "No such label version" }); return null; }
  const day = londonDateString(v.publishedAt);
  const image = archiveImage(
    { png: v.proofPng ? new Uint8Array(v.proofPng) : null, dpi: v.proofDpi },
    () => {
      const snapshot = v.snapshot as LabelSnapshot;
      const proof = proofLabel(snapshot, { printDate: day, productionDate: day }, fonts());
      return { bitmap: proof.bitmap, dpi: normaliseTemplate(snapshot.template).page.dpi };
    },
  );
  return { v, day, image };
}

router.get("/recipes/:id/versions/:versionNo/proof", async (req: Request, res: Response) => {
  try {
    const r = await versionImage(req, res);
    if (!r) return;
    res.setHeader("Content-Type", "image/png");
    res.setHeader("X-Label-Proof-Source", r.image.source);
    // A stored image never changes; a re-draw may be replaced by the backfill.
    res.setHeader("Cache-Control", r.image.source === "stored" ? "private, max-age=86400" : "private, no-cache");
    // The stored bytes as they are; a re-draw encoded fresh.
    res.send(r.image.source === "stored" && r.v.proofPng ? Buffer.from(r.v.proofPng) : Buffer.from(encodePng(r.image.bitmap)));
  } catch (err) { fail(res, err, "GET proof"); }
});

router.get("/recipes/:id/versions/:versionNo/pdf", async (req: Request, res: Response) => {
  try {
    const r = await versionImage(req, res);
    if (!r) return;
    // Stamped across the label (as test prints are) so an archive copy can
    // never be printed and stuck on a pack by mistake.
    stampTest(r.image.bitmap, fonts(), archiveStampText(r.v.versionNo));
    const pdf = labelsPdf({
      bitmap: r.image.bitmap, dpi: r.image.dpi, copies: 1,
      title: `ARCHIVE - ${r.v.recipeName} label v${r.v.versionNo} published ${r.day}${r.image.source === "redrawn" ? " (re-drawn from saved settings)" : ""} - NOT FOR PRINTING`,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${archivePdfFilename(r.v.recipeName, r.v.versionNo, r.day)}"`);
    res.setHeader("X-Label-Proof-Source", r.image.source);
    res.setHeader("Cache-Control", "private, no-cache");
    res.send(Buffer.from(pdf));
  } catch (err) { fail(res, err, "GET pdf"); }
});

export default router;
