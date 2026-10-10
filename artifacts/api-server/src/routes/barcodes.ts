/**
 * Barcodes (Graeme, 2026-10-10). Objectives A and F.
 *
 * Our table is the source of truth for scanning; nothing here writes to
 * Shopify. Rules: @workspace/barcodes. DB side: lib/barcode-store.ts.
 *
 *   GET  /recipes/:id                    a recipe's barcode groups + recent history (signed in)
 *   PUT  /recipes/:id/:kind              set a group's barcode; 409 asks to confirm a move (manager/admin)
 *   POST /variants/:variantId/use-shopify   take Shopify's barcode (manager/admin)
 *   PUT  /variants/:variantId/same-product  mark a listing the same product as another (admin)
 *   GET  /overview                       every group, clashes, reused codes (manager/admin)
 *   POST /pull                           one-time pull / check now, dry run or real (admin) — READS Shopify
 *   GET  /scan-map                       live variant → barcode map for the packing screen
 *   POST /scan-rejections                log a refused / unmatched scan (packing screen)
 *   GET  /scan-rejections                recent refused scans (manager/admin)
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { LINK_KINDS, type LinkKind } from "@workspace/barcodes";
import { requireAdmin, requireManagerOrAdmin } from "../middleware/roles";
import { validate, validateQuery } from "../middleware/validate";
import { requireFulfilmentAccess } from "../lib/fulfilment-access";
import {
  BarcodeRefused, loadEvents, loadGroups, loadOverview, loadScanRejections, logScanRejection, reconcileBarcodes, scanMap,
  setGroupBarcode, setSameProductAs, useShopifyBarcode, type Actor,
} from "../lib/barcode-store";

const router: IRouter = Router();

async function actor(req: Request): Promise<Actor> {
  const id = req.session.userId ?? null;
  if (!id) return { id: null, name: null };
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
  return { id, name: u?.name ?? null };
}

function fail(res: Response, err: unknown, where: string) {
  if (err instanceof BarcodeRefused) {
    res.status(err.status).json({ error: err.message, ...err.extra });
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[barcodes] ${where}:`, err);
  res.status(500).json({ error: msg });
}

const RecipeParams = z.object({ id: z.coerce.number().int().positive() });
const GroupParams = RecipeParams.extend({ kind: z.enum(LINK_KINDS as unknown as [LinkKind, ...LinkKind[]]) });
const VariantParams = z.object({ variantId: z.string().regex(/^\d{1,20}$/) });

router.get("/recipes/:id", async (req, res) => {
  const p = RecipeParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }
  try {
    const [{ groups }, events] = await Promise.all([loadGroups(p.data.id), loadEvents({ recipeId: p.data.id, limit: 20 })]);
    res.json({ groups, events });
  } catch (err) { fail(res, err, "GET /recipes/:id"); }
});

const Confirm = { confirmMove: z.boolean().optional(), confirmTake: z.boolean().optional() };
const SetBody = z.object({ barcode: z.string().max(40), ...Confirm });

router.put("/recipes/:id/:kind", requireManagerOrAdmin, validate(SetBody), async (req, res) => {
  const p = GroupParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid recipe or kind" }); return; }
  const body = req.body as z.infer<typeof SetBody>;
  try {
    const group = await setGroupBarcode(p.data.id, p.data.kind, body.barcode, await actor(req), { move: body.confirmMove, take: body.confirmTake });
    res.json({ group });
  } catch (err) { fail(res, err, "PUT /recipes/:id/:kind"); }
});

const ConfirmBody = z.object(Confirm);

router.post("/variants/:variantId/use-shopify", requireManagerOrAdmin, validate(ConfirmBody), async (req, res) => {
  const p = VariantParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid variant id" }); return; }
  const body = req.body as z.infer<typeof ConfirmBody>;
  try {
    await useShopifyBarcode(p.data.variantId, await actor(req), { move: body.confirmMove, take: body.confirmTake });
    res.json({ ok: true });
  } catch (err) { fail(res, err, "POST /variants/:id/use-shopify"); }
});

const SameBody = z.object({ sameAs: z.string().regex(/^\d{1,20}$/).nullable() });

router.put("/variants/:variantId/same-product", requireAdmin, validate(SameBody), async (req, res) => {
  const p = VariantParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid variant id" }); return; }
  try {
    await setSameProductAs(p.data.variantId, (req.body as z.infer<typeof SameBody>).sameAs, await actor(req));
    res.json({ ok: true });
  } catch (err) { fail(res, err, "PUT /variants/:id/same-product"); }
});

router.get("/overview", requireManagerOrAdmin, async (_req, res) => {
  try { res.json(await loadOverview()); } catch (err) { fail(res, err, "GET /overview"); }
});

const PullBody = z.object({ dryRun: z.boolean(), mode: z.enum(["pull", "check"]).default("pull") });

router.post("/pull", requireAdmin, validate(PullBody), async (req, res) => {
  const body = req.body as z.infer<typeof PullBody>;
  try {
    res.json(await reconcileBarcodes({ mode: body.mode, dryRun: body.dryRun, actor: await actor(req) }));
  } catch (err) { fail(res, err, "POST /pull"); }
});

router.get("/scan-map", requireFulfilmentAccess, async (_req, res) => {
  try { res.json(await scanMap()); } catch (err) { fail(res, err, "GET /scan-map"); }
});

const RejectionBody = z.object({
  orderId: z.union([z.string(), z.number()]).transform(String).nullable().optional(),
  orderName: z.string().max(60).nullable().optional(),
  code: z.string().min(1).max(200),
  kind: z.enum(["wrong-item", "ambiguous", "unknown-barcode", "no-match", "already-picked"]),
  message: z.string().max(500).nullable().optional(),
});

router.post("/scan-rejections", requireFulfilmentAccess, validate(RejectionBody), async (req, res) => {
  const b = req.body as z.infer<typeof RejectionBody>;
  try {
    await logScanRejection({ actor: await actor(req), orderId: b.orderId ?? null, orderName: b.orderName ?? null, code: b.code, kind: b.kind, message: b.message ?? null });
    res.json({ ok: true });
  } catch (err) { fail(res, err, "POST /scan-rejections"); }
});

const RejectionsQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) });

router.get("/scan-rejections", requireManagerOrAdmin, validateQuery(RejectionsQuery), async (_req, res) => {
  try { res.json(await loadScanRejections((res.locals["query"] as z.infer<typeof RejectionsQuery>).limit)); }
  catch (err) { fail(res, err, "GET /scan-rejections"); }
});

export default router;
