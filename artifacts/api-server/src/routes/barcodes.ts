/**
 * Barcodes (Graeme, 2026-10-10; two-way with Shopify 2026-10-12). Objectives A, D and F.
 *
 * Our table is the single source of truth. A save here (either page) is sent
 * to Shopify automatically (lib/barcode-push.ts — the only writer); the
 * hourly check adopts Shopify's where we have none. Rules: @workspace/barcodes.
 * DB side: lib/barcode-store.ts.
 *
 *   GET  /recipes/:id                    a recipe's barcode groups + recent history (signed in)
 *   PUT  /recipes/:id/:kind              set a group's barcode (or, with no pack listing yet, the
 *                                        barcode HELD for the recipe); 409 asks to confirm a move (manager/admin)
 *   POST /variants/:variantId/use-shopify   take Shopify's barcode (manager/admin)
 *   POST /variants/:variantId/send-ours     send ours over a different number in Shopify (manager/admin)
 *   POST /variants/:variantId/retry-push    send again after "Not sent" (manager/admin)
 *   PUT  /variants/:variantId/same-product  mark a listing the same product as another (admin)
 *   POST /variants/:variantId/packer-set    packing bench: set the barcode of a product that has NONE,
 *                                           scanned off the pack after a check by eye (packing access)
 *   GET  /overview                       every group, clashes, reused codes (manager/admin)
 *   POST /pull                           one-time pull / check now, dry run or real (admin) — READS Shopify
 *   POST /shopify-sync/preview           what a bulk sync would change in Shopify / here — sends nothing (admin)
 *   POST /shopify-sync/apply             the bulk sync of the previewed items (admin)
 *   GET  /scan-map                       live variant → barcode map for the packing screen
 *   POST /scan-rejections                log a refused / unmatched scan (packing screen)
 *   GET  /scan-rejections                recent refused scans (manager/admin)
 *   GET  /f2f-links                      F2F copies to mark "same product as" their recipe's pack (dry run)
 *   POST /f2f-links                      apply the chosen ones (admin) — barcodes only, no recipe mapping
 *   POST /variants/:variantId/packer-share  packing bench (manager/admin): same product as the code's holder — share its barcode
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { LINK_KINDS, SCAN_REJECTION_KINDS, type LinkKind } from "@workspace/barcodes";
import { requireAdmin, requireManagerOrAdmin } from "../middleware/roles";
import { rawBody, validate, validateQuery } from "../middleware/validate";
import { requireFulfilmentAccess } from "../lib/fulfilment-access";
import {
  BarcodeRefused, actorOf, applyF2fLinks, applySync, f2fSuggestions, loadOwnership, loadEvents, loadGroups, loadOverview, loadScanRejections, logScanRejection,
  previewSync, reconcileBarcodes, retryPush, scanMap, sendOursToShopify,
  setGroupBarcode, setPackerBarcode, setSameProductAs, sharePackerBarcode, useShopifyBarcode, type Actor,
} from "../lib/barcode-store";

const router: IRouter = Router();

const actor = (req: Request): Promise<Actor> => actorOf(req.session.userId ?? null);

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

// Packing bench (Graeme, 12 Oct 2026): with ticking by hand switched off, a
// product with no barcode gets one here — the packer checks the pack by eye,
// scans it and confirms. Only when the product has none; a number another
// product holds is refused (fetch a manager). Changing a barcode stays on
// PUT /recipes/:id/:kind (manager/admin). The number is then sent to Shopify
// like any other save (barcode-push.ts).
const PackerSetBody = z.object({
  barcode: z.string().min(1).max(40),
  /** What the packer saw on screen — used only to name a variant we've never stored. */
  productName: z.string().max(300).nullable().optional(),
});

router.post("/variants/:variantId/packer-set", requireFulfilmentAccess, validate(PackerSetBody), async (req, res) => {
  const p = VariantParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid variant id" }); return; }
  const body = req.body as z.infer<typeof PackerSetBody>;
  try {
    res.json(await setPackerBarcode(p.data.variantId, body.barcode, await actor(req), body.productName ?? null));
  } catch (err) { fail(res, err, "POST /variants/:id/packer-set"); }
});

// Packing bench, manager/admin (Graeme, 28 Oct 2026): a listing that is the
// same pack as another product's ("Buttermilk Fried Chicken 400g + rice" =
// the plain 400g pack; a flow adds the rice) shares that product's barcode.
router.post("/variants/:variantId/packer-share", requireManagerOrAdmin, validate(PackerSetBody), async (req, res) => {
  const p = VariantParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid variant id" }); return; }
  const body = req.body as z.infer<typeof PackerSetBody>;
  try {
    res.json(await sharePackerBarcode(p.data.variantId, body.barcode, await actor(req), body.productName ?? null));
  } catch (err) { fail(res, err, "POST /variants/:id/packer-share"); }
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
  kind: z.enum(SCAN_REJECTION_KINDS),
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

router.get("/f2f-links", requireManagerOrAdmin, async (_req, res) => {
  try { res.json({ links: f2fSuggestions(await loadOwnership()) }); } catch (err) { fail(res, err, "GET /f2f-links"); }
});

const F2fBody = z.object({ variantIds: z.array(z.string().regex(/^\d{1,20}$/)).min(1).max(500) });

router.post("/f2f-links", requireAdmin, validate(F2fBody), async (req, res) => {
  try {
    const applied = await applyF2fLinks((req.body as z.infer<typeof F2fBody>).variantIds, await actor(req));
    res.json({ applied });
  } catch (err) { fail(res, err, "POST /f2f-links"); }
});

// ── App → Shopify (12 Oct 2026) ─────────────────────────────────────────────
// Every save above is sent to Shopify automatically (lib/barcode-push.ts).
// These are the person-driven ones: choose ours over a different number,
// retry a send that didn't go, and the one-time preview + bulk sync.

const EmptyBody = z.object({});

router.post("/variants/:variantId/send-ours", requireManagerOrAdmin, validate(EmptyBody), async (req, res) => {
  const p = VariantParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid variant id" }); return; }
  try { res.json(await sendOursToShopify(p.data.variantId, await actor(req))); }
  catch (err) { fail(res, err, "POST /variants/:id/send-ours"); }
});

router.post("/variants/:variantId/retry-push", requireManagerOrAdmin, validate(EmptyBody), async (req, res) => {
  const p = VariantParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid variant id" }); return; }
  try { res.json({ result: await retryPush(p.data.variantId, await actor(req)) }); }
  catch (err) { fail(res, err, "POST /variants/:id/retry-push"); }
});

/** Reads Shopify and our table; sends and saves nothing. */
router.post("/shopify-sync/preview", requireAdmin, validate(EmptyBody), async (_req, res) => {
  try { res.json(await previewSync()); } catch (err) { fail(res, err, "POST /shopify-sync/preview"); }
});

const SyncBody = z.object({
  items: z.array(z.object({ variantId: z.string().regex(/^\d{1,20}$/), action: z.enum(["overwrite", "fill", "adopt"]) })).min(1).max(1000),
});

router.post("/shopify-sync/apply", requireAdmin, validate(SyncBody), async (req, res) => {
  try {
    // Nested array: read it unstripped, then hold it to the same schema.
    const body = SyncBody.parse(rawBody(req));
    res.json(await applySync(body.items, await actor(req)));
  } catch (err) { fail(res, err, "POST /shopify-sync/apply"); }
});

export default router;
