/**
 * Back-label printing, Stage 2 first cut — /api/product-label-print.
 * Objectives D (traceable, lawful labels) and F.
 *
 *   GET  /:recipeId/preview?planItemId=&test=   what would print: version,
 *                                               dates, batch, or why it can't
 *   POST /:recipeId                             make the labels: a print-ready PDF
 *
 * Founder only for now (feature labels.print_back — Graeme tests it first).
 *
 * PRODUCTION (wrapping station): prints the LIVE label only, and only while
 * it still matches the recipe (no live label / "Label update needed" =
 * refused, never a guess). Print day = today (London); production day = the
 * plan's day for the given plan item (read from the database, not trusted
 * from the page).
 *
 * TEST (label review page, test: true): print and production day are both
 * today; prints the live label when there is one, otherwise the current
 * proof stamped "TEST — NOT FOR SALE". Recorded with kind 'test' — never
 * counted as labels put on product.
 *
 * The PDF is one label per page at the label size (whole printer dots),
 * each page the renderer's own bitmap — printed from any computer through
 * the label printer's normal driver. The same route can later return
 * TSPL/ZPL for the print bridge (format). Every run is recorded in
 * product_label_prints.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, productLabelPrintsTable, productionPlanItemsTable, productionPlansTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  buildPrintRecord, MAX_PRINT_COUNT, PRINT_REFUSAL_TEXT, printRefusal, normaliseTemplate, testPrintSource, TEST_STAMP_TEXT,
  type LabelSnapshot, type PrintRefusal,
} from "@workspace/product-labels";
import { labelsPdf, pngDataUrl, proofLabel, stampTest } from "@workspace/product-labels/render";
import { FOUNDER_FEATURES } from "@workspace/feature-registry";
import { requireFounderArea } from "../middleware/founder-area-access";
import { validate, validateQuery } from "../middleware/validate";
import { londonDateString } from "../lib/london-time";
import { buildCurrentLabel, fonts, loadLiveVersion, loadRecipe } from "../lib/product-labels-store";

const router: IRouter = Router();
// Back labels at the wrapping station are for EVERYONE signed in (Graeme,
// 12 Oct 2026: "Give everyone the label printing button") — they print only
// the approved live label. TEST prints (the label review page, which can
// stamp an unapproved proof) stay with the "Print back labels" grant.
const testPrintGate = requireFounderArea(FOUNDER_FEATURES.printBackLabels);
router.use((req: Request, res: Response, next) => {
  const q = req.query?.["test"];
  const isTest = q === "1" || q === "true" || (req.body && (req.body as { test?: unknown }).test === true);
  if (isTest) { testPrintGate(req, res, next); return; }
  next();
});

const RecipeParams = z.object({ recipeId: z.coerce.number().int().positive() });
const PreviewQuery = z.object({
  planItemId: z.coerce.number().int().positive().optional(),
  test: z.enum(["1", "true"]).optional(),
});
const PrintBody = z.object({
  count: z.number().int().min(1).max(MAX_PRINT_COUNT),
  planItemId: z.number().int().positive().optional(),
  /** A test print from the label review page (dated today, recorded as a test). */
  test: z.boolean().optional(),
  /** Only "pdf" today; the bridge formats come later. */
  format: z.literal("pdf").optional(),
});

/** The plan item's production day (and plan), checked against the recipe. */
async function planDay(planItemId: number | undefined, recipeId: number): Promise<{ planId: number | null; planItemId: number | null; productionDate: string } | { error: string }> {
  if (!planItemId) return { planId: null, planItemId: null, productionDate: londonDateString() };
  const [row] = await db
    .select({ planId: productionPlanItemsTable.planId, recipeId: productionPlanItemsTable.recipeId, planDate: productionPlansTable.planDate })
    .from(productionPlanItemsTable)
    .innerJoin(productionPlansTable, eq(productionPlansTable.id, productionPlanItemsTable.planId))
    .where(eq(productionPlanItemsTable.id, planItemId));
  if (!row) return { error: "That plan item doesn't exist." };
  if (row.recipeId !== recipeId) return { error: "That plan item is a different recipe." };
  return { planId: row.planId, planItemId, productionDate: String(row.planDate).slice(0, 10) };
}

/** Everything both endpoints need: which label prints, whether it may, and today's run. */
async function prepare(recipeId: number, planItemId: number | undefined, test: boolean) {
  const recipe = await loadRecipe(recipeId);
  if (!recipe) return { status: 404 as const, error: "Recipe not found" };
  // A test print is dated today, whatever plan it might belong to.
  const plan = await planDay(test ? undefined : planItemId, recipeId);
  if ("error" in plan) return { status: 400 as const, error: plan.error };
  const live = await loadLiveVersion(recipeId);
  const current = await buildCurrentLabel(recipe);
  const printDate = londonDateString();
  const matchesLive = !!live && live.snapshotHash === current.hash;

  const stamped = test && testPrintSource({ hasLive: !!live }) === "current-stamped";
  const snapshot: LabelSnapshot | null = live ? (live.snapshot as LabelSnapshot) : test ? current.snapshot : null;
  const proof = snapshot ? proofLabel(snapshot, { printDate, productionDate: plan.productionDate }, fonts()) : null;
  if (proof && stamped) stampTest(proof.bitmap, fonts(), TEST_STAMP_TEXT);

  const refusal: PrintRefusal | null = test
    ? (proof?.layout.fits ? null : "doesnt-fit")
    : printRefusal({ hasLive: !!live, matchesLive, fits: proof?.layout.fits ?? false });
  return {
    status: 200 as const, recipe, plan, live, matchesLive, current, snapshot, proof, refusal, printDate, stamped,
    png: proof ? (stamped ? pngDataUrl(proof.bitmap) : proof.png) : null,
  };
}

router.get("/:recipeId/preview", validateQuery(PreviewQuery), async (req: Request, res: Response) => {
  const p = RecipeParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }
  const q = res.locals.query as z.infer<typeof PreviewQuery>;
  const test = q.test !== undefined;
  try {
    const r = await prepare(p.data.recipeId, q.planItemId, test);
    if (r.status !== 200) { res.status(r.status).json({ error: r.error }); return; }
    res.json({
      recipeId: r.recipe.id,
      recipeName: r.recipe.name,
      test,
      /** live = the live label; current-stamped = today's proof, stamped TEST — NOT FOR SALE. */
      source: r.stamped ? "current-stamped" : "live",
      live: r.live ? { versionNo: r.live.versionNo, publishedAt: r.live.publishedAt, publishedByName: r.live.publishedByName } : null,
      liveMatchesRecipe: r.matchesLive,
      canPrint: r.refusal === null,
      refusal: r.refusal,
      refusalText: r.refusal ? PRINT_REFUSAL_TEXT[r.refusal] : null,
      dates: r.proof?.dates ?? { printDate: r.printDate, productionDate: r.plan.productionDate },
      png: r.refusal === null ? r.png : null,
      labelSize: r.snapshot ? { widthMm: normaliseTemplate(r.snapshot.template).page.widthMm, heightMm: normaliseTemplate(r.snapshot.template).page.heightMm } : null,
      maxCount: MAX_PRINT_COUNT,
    });
  } catch (err) {
    console.error("[product-label-print] preview:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/:recipeId", validate(PrintBody), async (req: Request, res: Response) => {
  const p = RecipeParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }
  const body = req.body as z.infer<typeof PrintBody>;
  const test = body.test === true;
  try {
    const r = await prepare(p.data.recipeId, body.planItemId, test);
    if (r.status !== 200) { res.status(r.status).json({ error: r.error }); return; }
    if (r.refusal || !r.proof || !r.snapshot || (!test && !r.live)) {
      res.status(409).json({ error: r.refusal ? PRINT_REFUSAL_TEXT[r.refusal] : "Can't print this label.", refusal: r.refusal });
      return;
    }
    const page = normaliseTemplate(r.snapshot.template).page;
    const title = `${test ? "TEST - " : ""}${r.recipe.name} - back labels`;
    const pdf = labelsPdf({ bitmap: r.proof.bitmap, dpi: page.dpi, copies: body.count, title });

    const userId = req.session.userId ?? null;
    const [u] = userId ? await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)) : [];
    const record = buildPrintRecord({
      recipe: { id: r.recipe.id, name: r.recipe.name },
      live: r.live && !r.stamped
        ? { id: r.live.id, versionNo: r.live.versionNo, snapshotHash: r.live.snapshotHash }
        : { id: null, versionNo: null, snapshotHash: r.current.hash },
      count: body.count,
      dates: r.proof.dates,
      plan: { planId: r.plan.planId, planItemId: r.plan.planItemId },
      format: "pdf",
      kind: test ? "test" : "production",
      user: { id: userId, name: u?.name ?? null },
    });
    await db.insert(productLabelPrintsTable).values(record);

    const safeName = r.recipe.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${test ? "TEST-" : ""}back-labels-${safeName}-${r.proof.dates.batchCode}-x${body.count}.pdf"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(pdf));
  } catch (err) {
    console.error("[product-label-print] print:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
