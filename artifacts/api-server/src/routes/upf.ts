/**
 * UPF (ultra-processed food) endpoints.
 *
 *   GET  /api/upf/summary  — live UPF % rollups for every recipe and
 *                            sub-recipe (weight of NOVA-4 ingredients over
 *                            total ingredient weight, resolved through
 *                            nested sub-recipes), plus which ingredients
 *                            still need classification.
 *   GET  /api/upf/shopify-sync      — what the menu card shows per Shopify
 *                                    product (UPF %, kcal and protein per
 *                                    portion) and why any figure is held back
 *   POST /api/upf/shopify-sync/run  — push to Shopify now (manager/admin);
 *                                    otherwise it runs every 10 minutes
 *   POST /api/upf/analyze  — classify ingredients on the NOVA scale with
 *                            Claude (admin/manager only — spends API
 *                            credit). Body: { ingredientIds?: number[],
 *                            force?: boolean }. With no ids it analyzes
 *                            every not-yet-analyzed ingredient that is
 *                            used in a recipe or sub-recipe. Manual
 *                            classifications are never overwritten unless
 *                            force is set.
 *
 * The classification itself is stored on the ingredients table
 * (nova_class 1-4, markers, reasoning, confidence) — see
 * lib/db/migrations/0027_add_upf_nova.sql.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, ingredientsTable, recipeIngredientsTable, subRecipeIngredientsTable, usersTable } from "@workspace/db";
import { eq, inArray, and, isNull, sql } from "drizzle-orm";
import { isClaudeConfigured } from "../lib/ai/claude";
import { classifyBatch, classifyDeclaration, type Classification, type IngredientRow } from "../lib/upf-classify";
import { computeUpfSummary } from "../lib/upf";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { runUpfShopifySync, lastUpfSyncRun } from "../lib/upf-shopify-sync";
import { heldByDesign, isPer100gOnlyPanel } from "../lib/upf-shopify-plan";
import { shopifyWritesBlocked } from "../services/shopify";

const router: IRouter = Router();

router.get("/summary", async (_req: Request, res: Response) => {
  try {
    const summary = await computeUpfSummary();
    res.json(summary);
  } catch (err) {
    console.error("[upf] summary failed:", err);
    res.status(500).json({ error: "Failed to compute UPF summary" });
  }
});

// Classification spends Anthropic API credit — managers and admins only.
async function requireAdminOrManager(req: Request, res: Response, next: NextFunction) {
  if (req.session.userRole === "admin" || req.session.userRole === "manager") { next(); return; }
  if (req.session.userId && !req.session.userRole) {
    const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.session.userId));
    if (user) {
      req.session.userRole = user.role as "admin" | "manager" | "viewer";
      if (user.role === "admin" || user.role === "manager") { next(); return; }
    }
  }
  res.status(403).json({ error: "Manager access required" });
}

const BATCH_SIZE = 12;

// Live NOVA preview for the ingredient form (Graeme, 23 Oct 2026 — objective
// G): classifies the declaration being typed, stores NOTHING. The save runs
// the same classification server-side and stores it (cached, so the preview
// and the save are one AI call). Falls back to the UPF marker scan when the
// AI isn't available; null = couldn't decide.
export const upfPreviewBodySchema = z.object({
  labelDeclaration: z.string().trim().min(1, "Declaration is empty").max(5000),
  name: z.string().max(300).nullish(),
  brand: z.string().max(200).nullish(),
  category: z.string().max(100).nullish(),
});

router.post("/preview", validate(upfPreviewBodySchema), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof upfPreviewBodySchema>;
  try {
    const result = await classifyDeclaration({
      name: body.name ?? "",
      brand: body.brand ?? null,
      category: body.category ?? null,
      labelDeclaration: body.labelDeclaration,
    });
    res.json({ result });
  } catch (err) {
    console.error("[upf] preview failed:", err);
    res.status(502).json({ error: "Couldn't work out the UPF class just now" });
  }
});

router.post("/analyze", requireAdminOrManager, async (req: Request, res: Response) => {
  if (!isClaudeConfigured()) {
    res.status(503).json({ error: "UPF analysis requires the Anthropic API key. Ask an admin to set ANTHROPIC_API_KEY." });
    return;
  }

  const idsRaw = req.body?.ingredientIds;
  const force = req.body?.force === true;
  const requestedIds: number[] | null = Array.isArray(idsRaw)
    ? idsRaw.map(Number).filter(n => Number.isInteger(n) && n > 0)
    : null;

  try {
    let rows: IngredientRow[];
    const cols = {
      id: ingredientsTable.id,
      name: ingredientsTable.name,
      brand: ingredientsTable.brand,
      category: ingredientsTable.category,
      labelDeclaration: ingredientsTable.labelDeclaration,
      novaSource: ingredientsTable.novaSource,
    };

    if (requestedIds && requestedIds.length > 0) {
      rows = await db.select(cols).from(ingredientsTable).where(inArray(ingredientsTable.id, requestedIds));
    } else {
      // Default sweep: every ingredient used in a recipe or sub-recipe
      // that hasn't been analyzed yet (or all of them, with force).
      const [recUse, subUse] = await Promise.all([
        db.selectDistinct({ id: recipeIngredientsTable.ingredientId }).from(recipeIngredientsTable),
        db.selectDistinct({ id: subRecipeIngredientsTable.ingredientId }).from(subRecipeIngredientsTable),
      ]);
      const usedIds = [...new Set([...recUse.map(r => r.id), ...subUse.map(s => s.id)])];
      if (usedIds.length === 0) { res.json({ analyzed: 0, results: [] }); return; }
      rows = await db.select(cols).from(ingredientsTable).where(
        force
          ? inArray(ingredientsTable.id, usedIds)
          : and(inArray(ingredientsTable.id, usedIds), isNull(ingredientsTable.novaAnalyzedAt)),
      );
    }

    // Manual classifications stay put unless the caller forces a re-run.
    const targets = rows.filter(r => force || r.novaSource !== "manual");
    if (targets.length === 0) { res.json({ analyzed: 0, results: [] }); return; }

    const batches: IngredientRow[][] = [];
    for (let i = 0; i < targets.length; i += BATCH_SIZE) batches.push(targets.slice(i, i + BATCH_SIZE));

    const results: Classification[] = [];
    const errors: string[] = [];
    // Modest concurrency — enough to make a full sweep quick without
    // hammering rate limits.
    const CONCURRENCY = 3;
    let next = 0;
    async function worker() {
      while (next < batches.length) {
        const batch = batches[next++];
        try {
          results.push(...await classifyBatch(batch));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[upf] batch classification failed:", msg);
          errors.push(msg);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

    const now = new Date();
    for (const c of results) {
      await db.update(ingredientsTable)
        .set({
          novaClass: c.novaClass,
          novaMarkers: c.markers,
          novaReasoning: c.reasoning || (c.isFood ? null : "Not a food item"),
          novaConfidence: c.confidence,
          novaSource: "ai",
          novaAnalyzedAt: now,
        })
        .where(eq(ingredientsTable.id, c.ingredientId));
    }

    res.json({
      analyzed: results.length,
      upfCount: results.filter(r => r.novaClass === 4).length,
      failedBatches: errors.length,
      results,
    });
  } catch (err) {
    console.error("[upf] analyze failed:", err);
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `UPF analysis failed: ${msg}` });
  }
});

// UPF %, calories and protein on the website (lib/upf-shopify-sync.ts,
// migration 0214).
router.get("/shopify-sync", async (_req: Request, res: Response) => {
  try {
    const r = await db.execute<{
      product_gid: string; product_title: string | null; recipe_names: string | null; status: string;
      upf_percent: string | null; upf_published: string | null; upf_held: string | null;
      kcal_per_portion: number | null; kcal_published: number | null; kcal_held: string | null;
      protein_per_portion: string | null; protein_published: string | null; protein_held: string | null;
      nutrition_panel: string | null; nutrition_published: string | null; nutrition_held: string | null;
      last_error: string | null; checked_at: string; written_at: string | null;
    }>(sql`
      SELECT product_gid, product_title, recipe_names, status,
             upf_percent::text, upf_published::text, upf_held,
             kcal_per_portion, kcal_published, kcal_held,
             protein_per_portion::text, protein_published::text, protein_held,
             nutrition_panel, nutrition_published, nutrition_held,
             last_error, checked_at, written_at
        FROM upf_shopify_sync WHERE status <> 'unlinked' ORDER BY product_title
    `);
    const num = (v: string | number | null) => (v == null ? null : Number(v));
    res.json({
      writesBlocked: shopifyWritesBlocked(),
      lastRun: lastUpfSyncRun(),
      products: r.rows.map(x => ({
        productId: x.product_gid.split("/").pop(),
        productTitle: x.product_title,
        recipeNames: x.recipe_names,
        status: x.status,
        upf: { value: num(x.upf_percent), published: num(x.upf_published), heldBecause: x.upf_held },
        // byDesign: held back because the recipe has no pack size (per
        // 100 g only) — intended, so not counted as "a figure held back".
        kcal: { value: num(x.kcal_per_portion), published: num(x.kcal_published), heldBecause: x.kcal_held, byDesign: heldByDesign(x.kcal_held) },
        protein: { value: num(x.protein_per_portion), published: num(x.protein_published), heldBecause: x.protein_held, byDesign: heldByDesign(x.protein_held) },
        nutrition: { value: x.nutrition_panel == null ? null : 1, published: x.nutrition_published == null ? null : 1, heldBecause: x.nutrition_held, per100gOnly: isPer100gOnlyPanel(x.nutrition_panel) },
        lastError: x.last_error,
        checkedAt: x.checked_at,
        writtenAt: x.written_at,
      })),
    });
  } catch (err) {
    console.error("[upf] shopify-sync status failed:", err);
    res.status(500).json({ error: "Couldn't load what the website shows" });
  }
});

router.post("/shopify-sync/run", requireAdminOrManager, validate(z.object({})), async (_req: Request, res: Response) => {
  try {
    res.json(await runUpfShopifySync());
  } catch (err) {
    console.error("[upf] shopify-sync run failed:", err);
    res.status(502).json({ error: err instanceof Error ? err.message : "Sync failed" });
  }
});

export default router;
