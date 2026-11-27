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
import { db, productLabelPrintsTable, productLabelSettingsTable, productLabelVersionsTable } from "@workspace/db";
import { isNotNull } from "drizzle-orm";
import {
  labelFormat, MAX_PRINT_COUNT, PRINT_REFUSAL_TEXT, normaliseTemplate,
} from "@workspace/product-labels";
import { proofPdf } from "@workspace/product-labels/render";
import { validate, validateQuery } from "../middleware/validate";
import { prepare, printRecordFor } from "../lib/product-label-print-prepare";

const router: IRouter = Router();
// Every print here is for EVERYONE signed in: back labels at the wrapping
// station (Graeme, 12 Oct 2026: "Give everyone the label printing button"),
// real labels dated today, and TEST prints from a product's label page
// (Graeme, 15 Oct 2026: "Anyone should be able to do a test print" — a test
// print is stamped TEST — NOT FOR SALE when there's no live label, and is
// recorded as a test, so it can't pass for a real one).

const RecipeParams = z.object({ recipeId: z.coerce.number().int().positive() });
// role: which of the recipe's labels (label-roles.ts) — the wrapping
// station asks for "wrapping" when the recipe has a wrapping label (the
// cinnamon buns' freezer label). None = the main label, as before.
const Role = z.enum(["main", "wrapping"]).optional();
const PreviewQuery = z.object({
  planItemId: z.coerce.number().int().positive().optional(),
  test: z.enum(["1", "true"]).optional(),
  role: Role,
});
const PrintBody = z.object({
  count: z.number().int().min(1).max(MAX_PRINT_COUNT),
  role: Role,
  planItemId: z.number().int().positive().optional(),
  /** A test print from the label review page (dated today, recorded as a test). */
  test: z.boolean().optional(),
  /** Only "pdf" today; the bridge formats come later. */
  format: z.literal("pdf").optional(),
});

// Which recipes have a published (live) label — the wrapping station shows
// "Print back labels" only for these (Graeme, 19 Oct 2026: the macaroni
// cheese button showed although no mac cheese label was ever published, and
// its preview used calzone cooking instructions). Real prints of anything
// else are already refused below (printRefusal: no live label).
router.get("/live-recipes", async (_req: Request, res: Response) => {
  const rows = await db.selectDistinct({ recipeId: productLabelVersionsTable.recipeId, role: productLabelVersionsTable.role })
    .from(productLabelVersionsTable)
    .where(isNotNull(productLabelVersionsTable.recipeId));
  // Recipes with a WRAPPING label (label-roles.ts): the wrapping station
  // prints that one instead ("Print freezer labels"), published or not —
  // the dialog says when it still needs publishing.
  const wrapping = await db.select({ recipeId: productLabelSettingsTable.recipeId })
    .from(productLabelSettingsTable)
    .where(isNotNull(productLabelSettingsTable.wrappingTemplateId));
  const liveWrapping = new Set(rows.filter(r => r.role === "wrapping").map(r => r.recipeId as number));
  res.json({
    recipeIds: [...new Set(rows.filter(r => r.role === "main").map(r => r.recipeId as number))],
    wrapping: wrapping.map(w => ({ recipeId: w.recipeId, live: liveWrapping.has(w.recipeId) })),
  });
});

router.get("/:recipeId/preview", validateQuery(PreviewQuery), async (req: Request, res: Response) => {
  const p = RecipeParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }
  const q = res.locals.query as z.infer<typeof PreviewQuery>;
  const test = q.test !== undefined;
  try {
    const r = await prepare(p.data.recipeId, q.planItemId, test, q.role ?? "main");
    if (r.status !== 200) { res.status(r.status).json({ error: r.error }); return; }
    res.json({
      recipeId: r.recipe.id,
      recipeName: r.recipe.name,
      role: r.role,
      /** "Small label" / "Back label" — the format of what prints. */
      formatName: r.snapshot ? labelFormat(r.snapshot.template).name : null,
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
      /** Labels per pack: 1, or 2 for a pair label (two labels in each pack). */
      labelsPerPack: r.proof?.pages.length ?? 1,
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
    const r = await prepare(p.data.recipeId, body.planItemId, test, body.role ?? "main");
    if (r.status !== 200) { res.status(r.status).json({ error: r.error }); return; }
    if (r.refusal || !r.proof || !r.snapshot || (!test && !r.live)) {
      res.status(409).json({ error: r.refusal ? PRINT_REFUSAL_TEXT[r.refusal] : "Can't print this label.", refusal: r.refusal });
      return;
    }
    const page = normaliseTemplate(r.snapshot.template).page;
    // "back labels" / "small labels" — the template's format (formats.ts).
    const kind = `${labelFormat(r.snapshot.template).name.toLowerCase()}s`;
    const title = `${test ? "TEST - " : ""}${r.recipe.name} - ${kind}`;
    const pdf = proofPdf(r.proof, page.dpi, body.count, title);

    const record = await printRecordFor(r, body.count, test, req.session.userId ?? null);
    await db.insert(productLabelPrintsTable).values(record);

    const safeName = r.recipe.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${test ? "TEST-" : ""}${kind.replace(/ /g, "-")}-${safeName}-${r.proof.dates.batchCode}-x${body.count}.pdf"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(pdf));
  } catch (err) {
    console.error("[product-label-print] print:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
