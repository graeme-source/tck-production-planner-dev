/**
 * "Create Shopify product" from a recipe (Graeme, 30 Oct 2026). Objective A:
 * click in a recipe, check what will be made, make it — a DRAFT product set
 * up the way he does it by hand and linked to the recipe so sales drive
 * production.
 *
 *   GET    /api/recipes/:id/shopify-listing          listing description + photo details
 *   PUT    /api/recipes/:id/shopify-listing          save the listing description (autosave)
 *   POST   /api/recipes/:id/shopify-listing/draft    "Draft with AI" — returns text, saves nothing
 *   GET    /api/recipes/:id/product-photo            the photo itself
 *   PUT    /api/recipes/:id/product-photo            upload / replace (base64 JSON; ≥ 1000 × 750,
 *                                                    checked from the image header; bigger body
 *                                                    limit in lib/big-body-routes.ts)
 *   DELETE /api/recipes/:id/product-photo            remove it
 *   GET    /api/recipes/:id/shopify-product          already in Shopify? (planner links + one read)
 *   POST   /api/recipes/:id/shopify-product/preview  what WOULD be made — reads only
 *   POST   /api/recipes/:id/shopify-product/create   make the draft (with the nutrition image PNG
 *                                                    drawn in the browser)
 *
 * Who: reading is for anyone signed in; every change, the AI draft and the
 * Shopify preview/create need a manager or admin (as the recipe editor's
 * Shopify section does).
 *
 * Safety: every Shopify write goes through shopifyGraphQLWrite (refuses on
 * staging or with BLOCK_SHOPIFY_WRITES=true). Products are made as DRAFTS
 * and nothing is ever published. Rules: lib/recipe-shopify-product-rules.ts;
 * run: lib/recipe-shopify-product-run.ts.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, recipesTable, recipeProductImagesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { checkProductPhoto } from "@workspace/product-labels";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import { shopifyWritesBlocked, ShopifyWritesBlockedError } from "../services/shopify";
import { draftListingDescription } from "../services/listing-description-writer";
import { liveShopify } from "../lib/test-box-shopify";
import { recipeContentLoader } from "../lib/recipe-shopify-content";
import {
  RunRefused, buildRecipePlan, listingRecipeData, recipeShopifyStatus, runRecipeCreate,
} from "../lib/recipe-shopify-product-run";

const router: IRouter = Router();

const IdParams = z.object({ id: z.coerce.number().int().positive() });
function recipeId(req: Request, res: Response): number | null {
  const p = IdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid recipe id" }); return null; }
  return p.data.id;
}

async function actor(req: Request) {
  const id = req.session.userId!;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
  return { id, name: u?.name ?? "Someone" };
}

async function recipeExists(id: number): Promise<boolean> {
  const [r] = await db.select({ id: recipesTable.id }).from(recipesTable).where(eq(recipesTable.id, id));
  return !!r;
}

function fail(res: Response, err: unknown, where: string) {
  if (err instanceof RunRefused) { res.status(err.status).json({ error: err.message }); return; }
  if (err instanceof ShopifyWritesBlockedError) { res.status(503).json({ error: err.message, code: err.code }); return; }
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[recipe-shopify-product] ${where}:`, msg);
  res.status(502).json({ error: `Couldn't reach Shopify: ${msg}` });
}

// ── The listing description ────────────────────────────────────────────────
async function listingState(id: number) {
  const [r] = await db.select({ listing: recipesTable.shopifyListingDescription }).from(recipesTable).where(eq(recipesTable.id, id));
  if (!r) return null;
  const [photo] = await db.select({
    width: recipeProductImagesTable.width, height: recipeProductImagesTable.height, byteSize: recipeProductImagesTable.byteSize,
    mimeType: recipeProductImagesTable.mimeType, filename: recipeProductImagesTable.filename,
    uploadedAt: recipeProductImagesTable.uploadedAt, uploadedByName: recipeProductImagesTable.uploadedByName,
  }).from(recipeProductImagesTable).where(eq(recipeProductImagesTable.recipeId, id));
  return { listingDescription: r.listing ?? "", photo: photo ?? null };
}

router.get("/:id/shopify-listing", async (req: Request, res: Response) => {
  const id = recipeId(req, res); if (!id) return;
  const s = await listingState(id);
  if (!s) { res.status(404).json({ error: "Recipe not found" }); return; }
  res.json(s);
});

const ListingBody = z.object({ listingDescription: z.string().max(5000, "That's too long for a product description").nullable() });
router.put("/:id/shopify-listing", requireManagerOrAdmin, validate(ListingBody), async (req: Request, res: Response) => {
  const id = recipeId(req, res); if (!id) return;
  const b = ListingBody.parse(req.body);
  const text = b.listingDescription?.replace(/\r\n?/g, "\n").trim() || null;
  const [row] = await db.update(recipesTable).set({ shopifyListingDescription: text }).where(eq(recipesTable.id, id)).returning({ id: recipesTable.id });
  if (!row) { res.status(404).json({ error: "Recipe not found" }); return; }
  res.json({ listingDescription: text ?? "" });
});

const DraftBody = z.object({});
router.post("/:id/shopify-listing/draft", requireManagerOrAdmin, validate(DraftBody), async (req: Request, res: Response) => {
  const id = recipeId(req, res); if (!id) return;
  const data = await listingRecipeData(id);
  if (!data) { res.status(404).json({ error: "Recipe not found" }); return; }
  const r = await draftListingDescription(data);
  if (!r.ok) { res.status(r.status).json({ error: r.error }); return; }
  res.json({ text: r.text, cautions: r.cautions, model: r.model });
});

// ── The product photo ──────────────────────────────────────────────────────
router.get("/:id/product-photo", async (req: Request, res: Response) => {
  const id = recipeId(req, res); if (!id) return;
  const [row] = await db.select({ data: recipeProductImagesTable.data, mime: recipeProductImagesTable.mimeType })
    .from(recipeProductImagesTable).where(eq(recipeProductImagesTable.recipeId, id));
  if (!row) { res.status(404).json({ error: "No photo" }); return; }
  res.setHeader("Content-Type", row.mime);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.send(row.data);
});

// ≈13.4 MB of base64 for the 10 MB maximum photo.
const PhotoBody = z.object({
  dataBase64: z.string().min(100).max(14_500_000, "That photo is too big — the most is 10 MB"),
  filename: z.string().max(200).nullish(),
});
router.put("/:id/product-photo", requireManagerOrAdmin, validate(PhotoBody), async (req: Request, res: Response) => {
  const id = recipeId(req, res); if (!id) return;
  const b = PhotoBody.parse(req.body);
  const clean = b.dataBase64.replace(/^data:image\/[a-z+]+;base64,/i, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) { res.status(400).json({ error: "The photo didn't arrive properly — try again." }); return; }
  const bytes = Buffer.from(clean, "base64");
  // Width, height and type from the image's own header — never trusted from the browser.
  const check = checkProductPhoto(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  if (!check.ok) { res.status(422).json({ error: check.reason }); return; }
  if (!(await recipeExists(id))) { res.status(404).json({ error: "Recipe not found" }); return; }
  const who = await actor(req);
  const values = {
    data: bytes, mimeType: check.info.mime, width: check.info.width, height: check.info.height, byteSize: bytes.length,
    filename: b.filename?.trim() || null, uploadedById: who.id, uploadedByName: who.name, uploadedAt: new Date(),
  };
  await db.insert(recipeProductImagesTable).values({ recipeId: id, ...values })
    .onConflictDoUpdate({ target: recipeProductImagesTable.recipeId, set: values });
  const s = await listingState(id);
  res.json(s);
});

router.delete("/:id/product-photo", requireManagerOrAdmin, async (req: Request, res: Response) => {
  const id = recipeId(req, res); if (!id) return;
  await db.delete(recipeProductImagesTable).where(eq(recipeProductImagesTable.recipeId, id));
  const s = await listingState(id);
  if (!s) { res.status(404).json({ error: "Recipe not found" }); return; }
  res.json(s);
});

// ── Shopify product ────────────────────────────────────────────────────────
router.get("/:id/shopify-product", async (req: Request, res: Response) => {
  const id = recipeId(req, res); if (!id) return;
  try {
    res.json(await recipeShopifyStatus(id, liveShopify));
  } catch (err) { fail(res, err, "status"); }
});

const ShopifyId = z.string().regex(/^\d{1,20}$/, "A Shopify id is a number");
const PreviewBody = z.object({ templateProductId: ShopifyId.nullish() });
router.post("/:id/shopify-product/preview", requireManagerOrAdmin, validate(PreviewBody), async (req: Request, res: Response) => {
  const id = recipeId(req, res); if (!id) return;
  const b = PreviewBody.parse(req.body);
  try {
    const plan = await buildRecipePlan(id, { templateProductId: b.templateProductId ?? null }, liveShopify, recipeContentLoader(req), shopifyWritesBlocked());
    res.json(plan.preview);
  } catch (err) { fail(res, err, "preview"); }
});

// One run per recipe at a time: a double tap must not duplicate twice.
const running = new Set<number>();
const CreateBody = z.object({
  templateProductId: ShopifyId.nullish(),
  // The nutrition table as a base64 PNG (≈50 KB; the decoded bytes are
  // checked again by checkNutritionPng before any upload).
  nutritionPngBase64: z.string().min(100).max(800_000, "The nutrition image is too big").nullish(),
});
router.post("/:id/shopify-product/create", requireManagerOrAdmin, validate(CreateBody), async (req: Request, res: Response) => {
  const id = recipeId(req, res); if (!id) return;
  const b = CreateBody.parse(req.body);
  if (running.has(id)) { res.status(409).json({ error: "Already making this recipe's product — wait for it to finish." }); return; }
  running.add(id);
  try {
    const result = await runRecipeCreate(id, { templateProductId: b.templateProductId ?? null, nutritionPngBase64: b.nutritionPngBase64 ?? undefined }, await actor(req), liveShopify, recipeContentLoader(req), shopifyWritesBlocked());
    if (result.outcome === "blocked") { res.status(503).json({ ...result, error: result.message, code: "SHOPIFY_WRITES_BLOCKED" }); return; }
    res.json(result);
  } catch (err) {
    fail(res, err, "create");
  } finally {
    running.delete(id);
  }
});

export default router;
