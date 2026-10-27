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
 *   POST /print { tag }     one PDF: each flavour's label × its count
 *   PUT  /settings { useByDays }   managers/admins
 *
 * Counts come from the shared dessert report (lib/desserts-report).
 * Barcodes come from our barcode table, Shopify only as a fallback.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, appSettingsTable } from "@workspace/db";
import { addDays, formatLabelDate, SMALL_LABEL_PAGE } from "@workspace/product-labels";
import { labelRunsPdf, renderSmallLabel } from "@workspace/product-labels/render";
import { validate, validateQuery } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import { requireFulfilmentAccess } from "../lib/fulfilment-access";
import { londonDateString } from "../lib/london-time";
import { buildDessertReport, type FivePackLabelLine } from "../lib/desserts-report";
import { getOrdersByTag, getProductsByTag } from "../services/shopify";
import { scanQueueBarcodes } from "../lib/barcode-store";
import { fonts } from "../lib/product-labels-store";
import { shortError } from "../lib/finance/cash-flow";

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
    const lines = await linesFor(tag);
    res.json({
      tag, useByDays: days, useBy, useByIso,
      total: lines.reduce((t, l) => t + l.quantity, 0),
      labelSize: { widthMm: SMALL_LABEL_PAGE.widthMm, heightMm: SMALL_LABEL_PAGE.heightMm },
      lines: lines.map(l => {
        const { png, layout } = render(l, useBy);
        return { ...l, png, barcodeProblem: layout.barcodeProblem };
      }),
    });
  } catch (err) {
    console.error("[dessert-labels] list:", err);
    res.status(502).json({ error: shortError(err instanceof Error ? err.message : String(err)) });
  }
});

router.post("/print", validate(TagQuery), async (req: Request, res: Response) => {
  const { tag } = req.body as z.infer<typeof TagQuery>;
  try {
    const useBy = formatLabelDate(addDays(londonDateString(), await useByDays()));
    const lines = await linesFor(tag);
    if (!lines.length) { res.status(409).json({ error: "No 5-packs on these orders." }); return; }
    const runs = lines.map(l => ({ bitmap: render(l, useBy).bitmap, copies: l.quantity }));
    const pdf = labelRunsPdf({ runs, dpi: SMALL_LABEL_PAGE.dpi, title: `5-pack labels ${tag}` });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="5-pack-labels-${tag}.pdf"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(pdf));
  } catch (err) {
    console.error("[dessert-labels] print:", err);
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
