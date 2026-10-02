/**
 * Test box → Shopify draft products (Graeme, 2026-10-02). Objectives A (each
 * trial recipe gets its Shopify product — set up the way he does it by hand
 * and linked to the recipe so sales drive production — in one sitting) and I
 * (the launch checklist ticks itself).
 *
 *   POST /api/test-boxes/:id/shopify/preview   what WOULD happen — reads only
 *   POST /api/test-boxes/:id/shopify/create    make / update drafts (one recipe or all)
 *   GET  /api/test-boxes/:id/shopify/search    find an existing product to link (read only)
 *   POST /api/test-boxes/:id/shopify/link      link an existing variant to a recipe (no Shopify write)
 *   GET  /api/test-boxes/:id/shopify/collection           the collection step: status / what it would make
 *   POST /api/test-boxes/:id/shopify/collection           make it (needs recipes decided + all linked)
 *   POST /api/test-boxes/:id/shopify/discount/preview     the discount step: proposed code + settings
 *   POST /api/test-boxes/:id/shopify/discount             make the 20% code (needs the collection)
 *
 * Who: the page's door (founder, or a "founder.sales" grantee) for the
 * preview and search; creating or linking ALSO needs a manager or admin —
 * it writes to the live store / the planner's sales links, which the
 * founder area grant alone shouldn't allow for a viewer.
 *
 * Safety: every Shopify write goes through shopifyGraphQLWrite (refuses on
 * staging or with BLOCK_SHOPIFY_WRITES=true). Products are made as DRAFTS and
 * nothing is ever published. Rules: lib/test-box-shopify-rules.ts (with the
 * notes on how the store is set up); run: lib/test-box-shopify-run.ts.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { validate } from "../middleware/validate";
import { requireFounderArea } from "../middleware/founder-area-access";
import { requireManagerOrAdmin, resolveRole } from "../middleware/roles";
import { shopifyWritesBlocked, ShopifyWritesBlockedError } from "../services/shopify";
import { liveShopify, searchProducts } from "../lib/test-box-shopify";
import { collectionStatus, discountStatus, runCreateCollection, runCreateDiscount } from "../lib/test-box-shopify-launch";
import {
  RunRefused, boxRecipeIds, buildPlan, linkExisting, runCreate, type ContentLoader, type LoadedContent,
} from "../lib/test-box-shopify-run";

const router: IRouter = Router();
router.use("/:id/shopify", requireFounderArea("founder.sales"));

function idParam(req: Request): number | null {
  const id = Number(req.params["id"]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function actor(req: Request) {
  const id = req.session.userId!;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
  return { id, name: u?.name ?? "Someone" };
}

/**
 * The recipe's deck and nutrition straight from the app's own endpoints over
 * loopback (same pattern as push-ingredient-deck and the spec sheet), so the
 * product always says exactly what the recipe page says.
 */
function contentLoader(req: Request): ContentLoader {
  const port = process.env["PORT"];
  const cookie = req.headers.cookie ?? "";
  const get = async <T>(path: string): Promise<T | null> => {
    if (!port) return null;
    try {
      const r = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { cookie } });
      return r.ok ? ((await r.json()) as T) : null;
    } catch { return null; }
  };
  return async (recipeId: number): Promise<LoadedContent> => {
    const [deck, nutri] = await Promise.all([
      get<{ deckText: string; mayContainStatement: string | null; isComplete: boolean; missingDeclarations?: string[]; unwrappedDeclarations?: string[] }>(`/api/recipes/${recipeId}/ingredient-deck`),
      get<{ per100g: Record<string, number | null>; perPortion: Record<string, number | null>; portionWeightG: number; completeness: { missingNutritionals: string[] } }>(`/api/recipes/${recipeId}/nutritionals`),
    ]);
    return {
      deck: deck ? {
        deckText: deck.deckText ?? "", mayContainStatement: deck.mayContainStatement ?? null, isComplete: deck.isComplete === true,
        missing: [...(deck.missingDeclarations ?? []), ...(deck.unwrappedDeclarations ?? [])],
      } : null,
      nutrition: nutri ? {
        per100g: nutri.per100g, perPortion: nutri.perPortion, portionWeightG: nutri.portionWeightG,
        complete: (nutri.completeness?.missingNutritionals?.length ?? 0) === 0,
        missing: nutri.completeness?.missingNutritionals ?? [],
      } : null,
    };
  };
}

function fail(res: Response, err: unknown, where: string) {
  if (err instanceof RunRefused) { res.status(err.status).json({ error: err.message }); return; }
  if (err instanceof ShopifyWritesBlockedError) { res.status(503).json({ error: err.message, code: err.code }); return; }
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[test-box-shopify] ${where}:`, msg);
  res.status(502).json({ error: `Couldn't reach Shopify: ${msg}` });
}

const ShopifyId = z.string().regex(/^\d{1,20}$/, "A Shopify id is a number");
const Options = {
  templates: z.record(z.string().regex(/^\d+$/), ShopifyId).optional(),
  includeImages: z.boolean().default(true),
};

// ── Preview: reads only ────────────────────────────────────────────────────
const PreviewBody = z.object(Options);
router.post("/:id/shopify/preview", validate(PreviewBody), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = PreviewBody.parse(req.body);
  try {
    const plan = await buildPlan(id, { templates: b.templates, includeImages: b.includeImages }, liveShopify, contentLoader(req), shopifyWritesBlocked());
    const role = await resolveRole(req);
    res.json({ ...plan.preview, canCreate: role === "admin" || role === "manager" });
  } catch (err) { fail(res, err, "preview"); }
});

// ── Create (one recipe or all) ─────────────────────────────────────────────
const running = new Set<number>();
const CreateBody = z.object({
  recipeIds: z.array(z.number().int().positive()).min(1, "Pick at least one recipe").max(10),
  ...Options,
});
router.post("/:id/shopify/create", requireManagerOrAdmin, validate(CreateBody), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = CreateBody.parse(req.body);
  const inBox = new Set(await boxRecipeIds(id));
  if (!b.recipeIds.every(r => inBox.has(r))) { res.status(400).json({ error: "A recipe in the request isn't in this box" }); return; }
  // One run per box at a time: a double tap must not duplicate twice.
  if (running.has(id)) { res.status(409).json({ error: "Already making this box's products — wait for it to finish." }); return; }
  running.add(id);
  try {
    const result = await runCreate(id, b.recipeIds, { templates: b.templates, includeImages: b.includeImages }, await actor(req), liveShopify, contentLoader(req), shopifyWritesBlocked());
    res.status(result.stoppedByGuard ? 503 : 200).json(result.stoppedByGuard ? { ...result, error: result.stoppedByGuard, code: "SHOPIFY_WRITES_BLOCKED" } : result);
  } catch (err) {
    fail(res, err, "create");
  } finally {
    running.delete(id);
  }
});

// ── Find an existing product to link (read only) ───────────────────────────
const SearchQuery = z.object({ q: z.string().trim().min(2, "Type at least 2 letters").max(80) });
router.get("/:id/shopify/search", async (req: Request, res: Response) => {
  const parsed = SearchQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid search" }); return; }
  try {
    res.json({ products: await searchProducts(liveShopify, parsed.data.q) });
  } catch (err) { fail(res, err, "search"); }
});

// ── Link an existing product's variant to a recipe ─────────────────────────
const LinkBody = z.object({
  recipeId: z.number().int().positive(),
  variantIds: z.array(ShopifyId).min(1).max(5),
});
router.post("/:id/shopify/link", requireManagerOrAdmin, validate(LinkBody), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = LinkBody.parse(req.body);
  try {
    const r = await linkExisting(id, b.recipeId, b.variantIds, await actor(req), liveShopify);
    if (!r.linked.length) { res.status(409).json({ error: `Nothing linked: ${r.conflicts.join("; ")}`, ...r }); return; }
    res.json(r);
  } catch (err) { fail(res, err, "link"); }
});

// ── "Create the Shopify collection" ────────────────────────────────────────
router.get("/:id/shopify/collection", async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const role = await resolveRole(req);
    res.json({ ...(await collectionStatus(id, liveShopify, shopifyWritesBlocked())), canCreate: role === "admin" || role === "manager" });
  } catch (err) { fail(res, err, "collection status"); }
});

const ConfirmBody = z.object({ confirm: z.literal(true) });
router.post("/:id/shopify/collection", requireManagerOrAdmin, validate(ConfirmBody), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  if (running.has(id)) { res.status(409).json({ error: "Already working on this box — wait for it to finish." }); return; }
  running.add(id);
  try {
    res.json(await runCreateCollection(id, await actor(req), liveShopify, shopifyWritesBlocked()));
  } catch (err) { fail(res, err, "collection"); } finally { running.delete(id); }
});

// ── "Create the 20% discount code" ─────────────────────────────────────────
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const DiscountPreviewBody = z.object({ endOn: IsoDate.nullish() });
router.post("/:id/shopify/discount/preview", validate(DiscountPreviewBody), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = DiscountPreviewBody.parse(req.body);
  try {
    const role = await resolveRole(req);
    res.json({ ...(await discountStatus(id, liveShopify, shopifyWritesBlocked(), b.endOn ?? null)), canCreate: role === "admin" || role === "manager" });
  } catch (err) { fail(res, err, "discount preview"); }
});

const DiscountBody = z.object({
  code: z.string().trim().regex(/^CC[A-Z]{3}\d{2}-[A-Z0-9]{6}$/, "That isn't a test-box code"),
  endOn: IsoDate.nullable(),
});
router.post("/:id/shopify/discount", requireManagerOrAdmin, validate(DiscountBody), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = DiscountBody.parse(req.body);
  if (running.has(id)) { res.status(409).json({ error: "Already working on this box — wait for it to finish." }); return; }
  running.add(id);
  try {
    res.json(await runCreateDiscount(id, b.code, b.endOn, await actor(req), liveShopify, shopifyWritesBlocked()));
  } catch (err) { fail(res, err, "discount"); } finally { running.delete(id); }
});

export default router;
