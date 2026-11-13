/**
 * Brownie 5-pack despatch labels — /api/dessert-labels (Graeme, 2026-10-27).
 * Objectives A and F.
 *
 * Every 5-pack that comes out of the freezer gets a 102 × 25 mm label: the
 * flavour's name, "5 PACK", a use-by N days from printing (they're defrosted
 * and must be eaten within that time) and THAT variant's barcode — so it
 * scans at packing. One tap prints every label for a delivery day in one PDF.
 *
 *   GET  /?tag=YYYY-MM-DD   the day's 5-packs by variant, with proofs
 *   POST /print { tag, counts? }   one PDF: each flavour's label × its count
 *        (counts = { variantId-or-title: n } for "Print some", each capped
 *        at that flavour's day's quantity — fix-queue #374)
 *   PUT  /settings { useByDays }   managers/admins
 *   GET  /despatch?tag=, POST /despatch/print   cinnamon bun despatch labels (below)
 *
 * Counts come from the shared dessert report (lib/desserts-report).
 * Barcodes come from our barcode table, Shopify only as a fallback.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db, appSettingsTable, productLabelPrintsTable, usersTable } from "@workspace/db";
import {
  addDays, buildPrintRecord, formatLabelDate, MAX_PRINT_COUNT, PRINT_REFUSAL_TEXT, printRefusal, SMALL_LABEL_PAGE, type LabelSnapshot,
} from "@workspace/product-labels";
import { labelRunsPdf, labelsPdf, proofLabel, renderSmallLabel } from "@workspace/product-labels/render";
import { validate, validateQuery } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import { requireFulfilmentAccess } from "../lib/fulfilment-access";
import { londonDateString } from "../lib/london-time";
import {
  buildDessertReport, despatchLabelCount, despatchLabelLines, type DespatchLabelLine, type FivePackLabelLine,
} from "../lib/desserts-report";
import { getOrdersByTag, getProductsByTag } from "../services/shopify";
import { scanQueueBarcodes } from "../lib/barcode-store";
import { buildCurrentLabel, fonts, loadLiveVersion, loadRecipe } from "../lib/product-labels-store";
import { shortError } from "../lib/finance/cash-flow";
import { fivePackLabelCopies, fivePackLineKey, labelCountToPrint, labelsLeft } from "../lib/dessert-label-counts";

const router: IRouter = Router();
router.use(requireFulfilmentAccess);

const USE_BY_KEY = "dessert_five_pack_use_by_days";
/** "About 2 weeks" (Graeme) until someone sets it. */
const DEFAULT_USE_BY_DAYS = 14;
const SECOND_LINE = "5 pack";

async function useByDays(): Promise<number> {
  const [row] = await db.select({ value: appSettingsTable.value }).from(appSettingsTable).where(eq(appSettingsTable.key, USE_BY_KEY));
  const n = Number(row?.value);
  return Number.isInteger(n) && n >= 1 && n <= 90 ? n : DEFAULT_USE_BY_DAYS;
}

interface LabelLine extends FivePackLabelLine { barcode: string | null }

async function linesFor(tag: string): Promise<LabelLine[]> {
  const [titles, orders] = await Promise.all([getProductsByTag("Desserts"), getOrdersByTag(tag)]);
  const { fivePackLabels } = buildDessertReport(orders, titles);
  const barcodes = await scanQueueBarcodes(fivePackLabels.map(l => l.variantId).filter((v): v is string => !!v));
  return fivePackLabels.map(l => ({ ...l, barcode: (l.variantId && barcodes[l.variantId]) || null }));
}

// ── What's been printed for a dispatch day (Graeme, 13 Nov 2026) ──────────
// Every print is recorded, so the report asks only for the labels still
// needed: a second despatch prints just the new orders' labels.

type PrintKind = "five_pack" | "despatch";

async function printedFor(tag: string, kind: PrintKind): Promise<Record<string, number>> {
  const r = await db.execute<{ item_key: string; copies: string }>(sql`
    SELECT item_key, SUM(copies)::text AS copies FROM dessert_label_prints
    WHERE tag = ${tag} AND kind = ${kind} GROUP BY item_key
  `);
  return Object.fromEntries(r.rows.map(x => [x.item_key, Number(x.copies)]));
}

async function recordPrinted(tag: string, kind: PrintKind, items: Array<{ key: string; copies: number }>, userId: number | null): Promise<void> {
  for (const it of items) {
    if (it.copies < 1) continue;
    await db.execute(sql`
      INSERT INTO dessert_label_prints (tag, kind, item_key, copies, printed_by)
      VALUES (${tag}, ${kind}, ${it.key}, ${it.copies}, ${userId})
    `);
  }
}

function render(line: FivePackLabelLine & { barcode: string | null }, useBy: string) {
  return renderSmallLabel({ name: line.productTitle, secondLine: SECOND_LINE, useBy, barcode: line.barcode }, fonts());
}

const TagQuery = z.object({ tag: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

router.get("/", validateQuery(TagQuery), async (_req: Request, res: Response) => {
  const { tag } = res.locals["query"] as z.infer<typeof TagQuery>;
  try {
    const days = await useByDays();
    const useByIso = addDays(londonDateString(), days);
    const useBy = formatLabelDate(useByIso);
    const [lines, printed] = await Promise.all([linesFor(tag), printedFor(tag, "five_pack")]);
    const withLeft = lines.map(l => {
      const done = printed[fivePackLineKey(l)] ?? 0;
      return { ...l, printed: done, left: labelsLeft(l.quantity, done) };
    });
    res.json({
      tag, useByDays: days, useBy, useByIso,
      total: lines.reduce((t, l) => t + l.quantity, 0),
      printed: withLeft.reduce((t, l) => t + l.printed, 0),
      left: withLeft.reduce((t, l) => t + l.left, 0),
      labelSize: { widthMm: SMALL_LABEL_PAGE.widthMm, heightMm: SMALL_LABEL_PAGE.heightMm },
      lines: withLeft.map(l => {
        const { png, layout } = render(l, useBy);
        return { ...l, png, barcodeProblem: layout.barcodeProblem };
      }),
    });
  } catch (err) {
    console.error("[dessert-labels] list:", err);
    res.status(502).json({ error: shortError(err instanceof Error ? err.message : String(err)) });
  }
});

/** No counts = the labels still needed. "Print some" (ad hoc) = per-flavour
 *  counts, printed as chosen (13 Nov 2026: no longer capped at the orders). */
const FivePackPrintBody = TagQuery.extend({
  counts: z.record(z.string(), z.number().int().min(0).max(MAX_PRINT_COUNT)).optional(),
});

router.post("/print", validate(FivePackPrintBody), async (req: Request, res: Response) => {
  const { tag, counts } = req.body as z.infer<typeof FivePackPrintBody>;
  try {
    const useBy = formatLabelDate(addDays(londonDateString(), await useByDays()));
    const [lines, printed] = await Promise.all([linesFor(tag), printedFor(tag, "five_pack")]);
    if (!lines.length && !counts) { res.status(409).json({ error: "No 5-packs on these orders." }); return; }
    const chosen = fivePackLabelCopies(lines, counts, printed);
    if (!chosen.length) {
      res.status(409).json({ error: counts ? "Choose at least one label to print." : "All the 5-pack labels for these orders have been printed." });
      return;
    }
    const runs = chosen.map(l => ({ bitmap: render(l, useBy).bitmap, copies: l.copies }));
    const pdf = labelRunsPdf({ runs, dpi: SMALL_LABEL_PAGE.dpi, title: `5-pack labels ${tag}` });
    await recordPrinted(tag, "five_pack", chosen.map(l => ({ key: fivePackLineKey(l), copies: l.copies })), req.session.userId ?? null);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="5-pack-labels-${tag}.pdf"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(pdf));
  } catch (err) {
    console.error("[dessert-labels] print:", err);
    res.status(502).json({ error: shortError(err instanceof Error ? err.message : String(err)) });
  }
});

// ── Despatch labels for the other desserts (cinnamon buns) ─────────────────
// Graeme, 2026-10-27: the buns are wrapped with a small 180-day freezer
// label; on the despatch morning they come out of the freezer and the big
// 140 × 94 label — best before despatch + 3, use by despatch + 5 — goes over
// the top. One tap beside the line on the dessert report prints that line's
// quantity of the recipe's LIVE main label, dated today. Nothing prints
// unless the live label still matches the recipe (as at wrapping).
//
//   GET  /despatch?tag=YYYY-MM-DD            each line: its recipe, count, ready or why not
//   POST /despatch/print { tag, recipeId, count? }   one PDF: that recipe's label × its count
//        (no count = the labels still needed; count = "Print some", ad hoc)

/** Shopify variant → recipe, through the recipe ↔ Shopify link (pack,
 *  wonky and 8-pack variants), as the stock and P&L code reads it. */
async function variantRecipeMap(): Promise<Map<string, number>> {
  const r = await db.execute<{ recipe_id: number; shopify_variant_id: string | null; wonky_variant_id: string | null; eight_pack_variant_id: string | null }>(sql`
    SELECT recipe_id, shopify_variant_id, wonky_variant_id, eight_pack_variant_id FROM recipe_shopify_mappings`);
  const out = new Map<string, number>();
  for (const m of r.rows) {
    for (const v of [m.shopify_variant_id, m.wonky_variant_id, m.eight_pack_variant_id]) if (v) out.set(String(v), m.recipe_id);
  }
  return out;
}

async function despatchLines(tag: string): Promise<DespatchLabelLine[]> {
  const [titles, orders, map] = await Promise.all([getProductsByTag("Desserts"), getOrdersByTag(tag), variantRecipeMap()]);
  return despatchLabelLines(buildDessertReport(orders, titles).products, map);
}

/** A recipe's despatch (main) label dated today, or why it can't print. */
async function despatchLabel(recipeId: number) {
  const recipe = await loadRecipe(recipeId);
  if (!recipe) return { ready: false as const, recipeName: null, message: "That recipe no longer exists." };
  const notReady = (message: string) => ({ ready: false as const, recipeName: recipe.name, message });
  const live = await loadLiveVersion(recipe.id, "main");
  if (!live) return notReady(`Publish the ${recipe.name} label first.`);
  const current = await buildCurrentLabel(recipe);
  const today = londonDateString();
  const proof = proofLabel(live.snapshot as LabelSnapshot, { printDate: today, productionDate: today }, fonts());
  const refusal = printRefusal({ hasLive: true, matchesLive: live.snapshotHash === current.hash, fits: proof.layout.fits });
  if (refusal) {
    return notReady(refusal === "update-needed"
      ? `The ${recipe.name} label has changed since it was published — check it and update the live version first.`
      : PRINT_REFUSAL_TEXT[refusal]);
  }
  return { ready: true as const, recipeName: recipe.name, recipe, live, proof };
}

router.get("/despatch", validateQuery(TagQuery), async (_req: Request, res: Response) => {
  const { tag } = res.locals["query"] as z.infer<typeof TagQuery>;
  try {
    const [lines, printed] = await Promise.all([despatchLines(tag), printedFor(tag, "despatch")]);
    const byRecipe = new Map<number, Awaited<ReturnType<typeof despatchLabel>>>();
    const out = [];
    for (const l of lines) {
      if (l.recipeId == null) {
        out.push({ ...l, count: 0, recipeName: null, ready: false, message: `${l.title} isn't linked to a recipe — link its Shopify product on the recipe page.` });
        continue;
      }
      if (!byRecipe.has(l.recipeId)) byRecipe.set(l.recipeId, await despatchLabel(l.recipeId));
      const d = byRecipe.get(l.recipeId)!;
      out.push({
        ...l,
        count: despatchLabelCount(lines, l.recipeId),
        printed: printed[String(l.recipeId)] ?? 0,
        left: labelsLeft(despatchLabelCount(lines, l.recipeId), printed[String(l.recipeId)] ?? 0),
        recipeName: d.recipeName,
        ready: d.ready,
        message: d.ready ? null : d.message,
        dates: d.ready ? { useBy: d.proof.dates.chilledUseBy, printDate: d.proof.dates.printDate } : null,
        versionNo: d.ready ? d.live.versionNo : null,
      });
    }
    res.json({ tag, lines: out });
  } catch (err) {
    console.error("[dessert-labels] despatch list:", err);
    res.status(502).json({ error: shortError(err instanceof Error ? err.message : String(err)) });
  }
});

const DespatchPrintBody = TagQuery.extend({
  recipeId: z.number().int().positive(),
  /** "Print some" — ad hoc, printed as chosen. No count = still needed. */
  count: z.number().int().min(1).max(MAX_PRINT_COUNT).optional(),
});

router.post("/despatch/print", validate(DespatchPrintBody), async (req: Request, res: Response) => {
  const { tag, recipeId, count: requested } = req.body as z.infer<typeof DespatchPrintBody>;
  try {
    const [lines, printed] = await Promise.all([despatchLines(tag), printedFor(tag, "despatch")]);
    const count = Math.min(MAX_PRINT_COUNT, labelCountToPrint(despatchLabelCount(lines, recipeId), printed[String(recipeId)] ?? 0, requested));
    if (count < 1) { res.status(409).json({ error: requested ? "Choose at least one label to print." : "All these labels have been printed for the day." }); return; }
    const d = await despatchLabel(recipeId);
    if (!d.ready) { res.status(409).json({ error: d.message }); return; }
    const pdf = labelsPdf({ bitmap: d.proof.bitmap, dpi: d.proof.layout.dpi, copies: count, title: `${d.recipe.name} - despatch labels ${tag}` });
    const userId = req.session.userId ?? null;
    const [u] = userId ? await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)) : [];
    await db.insert(productLabelPrintsTable).values(buildPrintRecord({
      recipe: { id: d.recipe.id, name: d.recipe.name },
      live: { id: d.live.id, versionNo: d.live.versionNo, snapshotHash: d.live.snapshotHash },
      count,
      dates: d.proof.dates,
      plan: { planId: null, planItemId: null },
      format: "pdf",
      kind: "production",
      user: { id: userId, name: u?.name ?? null },
    }));
    await recordPrinted(tag, "despatch", [{ key: String(recipeId), copies: count }], userId);
    const safe = d.recipe.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${safe}-despatch-labels-${tag}-x${count}.pdf"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(pdf));
  } catch (err) {
    console.error("[dessert-labels] despatch print:", err);
    res.status(502).json({ error: shortError(err instanceof Error ? err.message : String(err)) });
  }
});

const SettingsBody = z.object({ useByDays: z.number().int().min(1).max(90) });

router.put("/settings", requireManagerOrAdmin, validate(SettingsBody), async (req: Request, res: Response) => {
  const { useByDays: days } = req.body as z.infer<typeof SettingsBody>;
  await db.insert(appSettingsTable).values({ key: USE_BY_KEY, value: String(days) })
    .onConflictDoUpdate({ target: appSettingsTable.key, set: { value: String(days), updatedAt: new Date() } });
  res.json({ ok: true, useByDays: days });
});

export default router;
