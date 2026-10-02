/**
 * Test box → Shopify draft products: the preview (reads only) and the run
 * (guarded writes), tying the database (box, recipes, links, what the app made
 * before) to the Shopify calls in test-box-shopify.ts and the rules in
 * test-box-shopify-rules.ts. Objectives A and I.
 *
 * Idempotent by construction:
 *   - a recipe already linked to a Shopify product it didn't make here is
 *     shown as "Already in Shopify" and never duplicated;
 *   - a product the app made is stored the moment Shopify returns its id
 *     (test_box_shopify_products), so a re-run UPDATES it.
 * The collection and discount code are their own launch steps
 * (test-box-shopify-launch.ts).
 */
import { db, testBoxesTable, testBoxRecipesTable, testBoxShopifyProductsTable, recipesTable } from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { shopifyAdminUrl, ShopifyWritesBlockedError } from "../services/shopify";
import { linkVariantToRecipe } from "./recipe-shopify-mapping";
import { headedParagraphsDocument, ingredientDeckDocument } from "./shopify-rich-text";
import { intArrayLiteral } from "./int-array-literal";
import { launchTaskKey } from "./test-box-launch-checklist";
import { syncTestBox, type Actor } from "./test-box-data";
import { tickTestBoxTask } from "./test-box-todos";
import {
  applyRecipeProduct, fetchAccessScopes, fetchProducts, fetchTemplateCandidates,
  fetchVariantProducts, type ProductSnapshot, type ShopifyPort,
} from "./test-box-shopify";
import {
  STANDARD_COOKING_SECTIONS, chooseTemplate, copiedFromRecipeId, decideRecipeAction, descriptionHtml,
  launchTicks, metafieldPlan, missingWriteScopes, nutritionRows,
  recipeWarnings, sameTitle, tagChanges, templateSearchQuery, testBoxTags, variantsToLink,
  type MetafieldLine, type RecipeAction, type RecipeContent, type TemplateCandidate,
} from "./test-box-shopify-rules";

// ── What the recipe's own data says (deck, nutrition) ───────────────────────
export interface LoadedContent {
  deck: { deckText: string; mayContainStatement: string | null; isComplete: boolean; missing: string[] } | null;
  nutrition: { per100g: Record<string, number | null>; perPortion: Record<string, number | null>; portionWeightG: number; complete: boolean; missing: string[] } | null;
}
export type ContentLoader = (recipeId: number) => Promise<LoadedContent>;

// ── Preview shape (mirrored in components/test-boxes/shopify-products-card.tsx) ─
export interface ProductLink { productId: string; title: string; status: string; adminUrl: string; variantTitle?: string }
export interface RecipePreview {
  recipeId: number;
  recipeName: string;
  isDraft: boolean;
  action: RecipeAction;
  linkedProducts: ProductLink[];
  createdProduct: ProductLink | null;
  possibleMatch: ProductLink | null;
  template: (ProductLink & { price: string | null; imageCount: number; reason: string }) | null;
  title: string;
  tags: string[];
  tagsRemoved: string[];
  statusAfter: string;
  barcode: string;
  imagesCopied: boolean;
  metafields: MetafieldLine[];
  nutrition: { complete: boolean; portionWeightG: number | null; rows: Array<{ label: string; per100g: string; perPortion: string }> };
  warnings: string[];
  blocking: string[];
}
export interface Preview {
  box: { id: number; name: string };
  writesBlocked: boolean;
  blockedMessage: string | null;
  missingScopes: string[];
  includeImages: boolean;
  templates: Array<TemplateCandidate & { adminUrl: string }>;
  recipes: RecipePreview[];
}

interface Internal {
  preview: Preview;
  perRecipe: Map<number, {
    content: RecipeContent;
    template: ProductSnapshot | null;
    templateMainVariantIds: string[];
    createdProductId: string | null;
    descriptionHtml: string;
  }>;
}

const STANDARD_COOKING = JSON.stringify(headedParagraphsDocument([...STANDARD_COOKING_SECTIONS]));
const reasonText: Record<string, string> = {
  chosen: "picked by you",
  "copied-from": "the product of the recipe this one was copied from",
  "previous-box": "the last test-box product",
  none: "",
};
const link = (p: { productId: string; title: string; status: string; variantTitle?: string }): ProductLink => ({ ...p, adminUrl: shopifyAdminUrl("products", p.productId) });

async function disclaimerText(): Promise<string | null> {
  const r = await db.execute<{ value: string | null }>(sql`SELECT value FROM app_settings WHERE key = 'legal_disclaimer_statement'`);
  return r.rows[0]?.value || null;
}

export class RunRefused extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Everything the preview shows, plus what the run needs. Reads only. */
export async function buildPlan(
  boxId: number,
  opts: { templates?: Record<string, string>; includeImages: boolean },
  port: ShopifyPort,
  loadContent: ContentLoader,
  writesBlocked: boolean,
): Promise<Internal> {
  const [box] = await db.select().from(testBoxesTable).where(eq(testBoxesTable.id, boxId));
  if (!box || box.deletedAt) throw new RunRefused(404, "Test box not found");

  const recipes = await db.select({
    id: recipesTable.id, name: recipesTable.name, description: recipesTable.description, packSize: recipesTable.packSize,
    notes: recipesTable.notes, isDraft: recipesTable.isDraft,
  }).from(testBoxRecipesTable)
    .innerJoin(recipesTable, eq(recipesTable.id, testBoxRecipesTable.recipeId))
    .where(eq(testBoxRecipesTable.testBoxId, boxId))
    .orderBy(asc(testBoxRecipesTable.position), asc(testBoxRecipesTable.id));

  const created = await db.select().from(testBoxShopifyProductsTable).where(eq(testBoxShopifyProductsTable.testBoxId, boxId));
  const createdBy = new Map(created.map(c => [c.recipeId, c]));

  const copiedFrom = new Map(recipes.map(r => [r.id, copiedFromRecipeId(r.notes)]));
  const mappingRecipeIds = [...new Set([...recipes.map(r => r.id), ...[...copiedFrom.values()].filter((x): x is number => x != null)])];
  const mappings = mappingRecipeIds.length
    ? (await db.execute<{ recipe_id: number; shopify_variant_id: string }>(sql`
        SELECT recipe_id, shopify_variant_id FROM recipe_shopify_mappings
        WHERE recipe_id = ANY(${intArrayLiteral(mappingRecipeIds)}::int[]) ORDER BY created_at
      `)).rows
    : [];

  const [scopes, candidates, variantProducts, disclaimer] = await Promise.all([
    fetchAccessScopes(port),
    fetchTemplateCandidates(port, templateSearchQuery()),
    fetchVariantProducts(port, mappings.map(m => String(m.shopify_variant_id))),
    disclaimerText(),
  ]);
  const productOfRecipe = (recipeId: number) => {
    const out = new Map<string, ProductLink>();
    for (const m of mappings) {
      if (Number(m.recipe_id) !== recipeId) continue;
      const v = variantProducts.get(String(m.shopify_variant_id));
      if (v && !out.has(v.productId)) out.set(v.productId, link({ productId: v.productId, title: v.title, status: v.status, variantTitle: v.variantTitle }));
    }
    return [...out.values()];
  };

  // Choose a template per recipe, then read the chosen ones + what we made.
  const chosen = new Map<number, ReturnType<typeof chooseTemplate>>();
  for (const r of recipes) {
    const from = copiedFrom.get(r.id);
    chosen.set(r.id, chooseTemplate({
      requested: opts.templates?.[String(r.id)] ?? null,
      copiedFromProductId: from != null ? productOfRecipe(from)[0]?.productId ?? null : null,
      candidates,
      boxName: box.name,
    }));
  }
  const snapshots = await fetchProducts(port, [
    ...[...chosen.values()].map(c => c.productId).filter((x): x is string => !!x),
    ...created.map(c => c.shopifyProductId),
  ]);

  const templateVariantIds = [...new Set([...chosen.values()].flatMap(c => (c.productId ? snapshots.get(c.productId)?.variants.map(v => v.id) ?? [] : [])))]
    .filter(id => /^\d+$/.test(id));
  const mainMapped = templateVariantIds.length
    ? new Set((await db.execute<{ shopify_variant_id: string }>(sql`
        SELECT shopify_variant_id FROM recipe_shopify_mappings WHERE shopify_variant_id = ANY(${`{${templateVariantIds.join(",")}}`}::text[])
      `)).rows.map(r => String(r.shopify_variant_id)))
    : new Set<string>();

  const contents = await Promise.all(recipes.map(r => loadContent(r.id)));
  const tags = testBoxTags(box.name);
  const perRecipe: Internal["perRecipe"] = new Map();
  const previews: RecipePreview[] = [];

  recipes.forEach((r, i) => {
    const mine = createdBy.get(r.id) ?? null;
    const mineSnap = mine ? snapshots.get(mine.shopifyProductId) ?? null : null;
    const linked = productOfRecipe(r.id);
    const action = decideRecipeAction({
      createdProductId: mine?.shopifyProductId ?? null,
      createdProductExists: mineSnap != null,
      mappedProductIds: linked.map(l => l.productId),
    });
    const choice = chosen.get(r.id)!;
    const template = choice.productId ? snapshots.get(choice.productId) ?? null : null;
    const loaded = contents[i];
    const deckDocument = loaded.deck?.isComplete
      ? JSON.stringify(ingredientDeckDocument({ deckText: loaded.deck.deckText, mayContainStatement: loaded.deck.mayContainStatement, disclaimer }))
      : null;
    const content: RecipeContent = {
      description: r.description,
      packSize: r.packSize,
      deckDocument,
      deckSummary: loaded.deck ? loaded.deck.deckText.replace(/\*\*/g, "") : null,
    };
    const base = action === "update" ? mineSnap : template;
    const plan = metafieldPlan(content, base?.metafields ?? [], STANDARD_COOKING);
    const { warnings, blocking } = recipeWarnings({
      action,
      templateFound: template != null,
      description: r.description,
      deckComplete: loaded.deck?.isComplete ?? false,
      deckMissing: loaded.deck?.missing ?? [],
      nutritionComplete: loaded.nutrition?.complete ?? false,
      nutritionMissing: loaded.nutrition?.missing ?? [],
      templateVariantCount: template?.variants.length ?? 0,
      existingStatus: action === "update" ? mineSnap?.status ?? null : null,
    });
    if (choice.productId && !template) blocking.push("The chosen template product isn't in Shopify any more — pick another.");
    if (mine && !mineSnap) warnings.push("The product the app made for this recipe before has gone from Shopify — it will be made again.");

    const possible = action === "create"
      ? candidates.find(c => c.tags.some(t => t.trim().toLowerCase() === box.name.trim().toLowerCase()) && sameTitle(c.title, r.name))
      : undefined;
    if (possible) warnings.push(`'${possible.title}' is already in Shopify with this box's tag — link it instead of making another.`);

    perRecipe.set(r.id, {
      content,
      template,
      templateMainVariantIds: template ? template.variants.filter(v => mainMapped.has(v.id)).map(v => v.id) : [],
      createdProductId: mineSnap ? mine!.shopifyProductId : null,
      descriptionHtml: r.description?.trim() ? descriptionHtml(r.description) : "",
    });
    previews.push({
      recipeId: r.id,
      recipeName: r.name,
      isDraft: r.isDraft === true,
      action,
      linkedProducts: action === "linked" ? linked : [],
      createdProduct: mineSnap ? link({ productId: mineSnap.id, title: mineSnap.title, status: mineSnap.status }) : null,
      possibleMatch: possible ? link({ productId: possible.productId, title: possible.title, status: possible.status }) : null,
      template: template ? {
        ...link({ productId: template.id, title: template.title, status: template.status }),
        price: template.variants[0]?.price ?? null, imageCount: template.imageCount, reason: reasonText[choice.reason],
      } : null,
      title: r.name,
      tags,
      tagsRemoved: tagChanges((action === "update" ? mineSnap?.tags : template?.tags) ?? [], tags).removed,
      statusAfter: action === "update" ? (mineSnap?.status ?? "DRAFT") : "DRAFT",
      barcode: action === "create" ? "Left blank — add the GS1 barcode by hand" : "Not changed",
      imagesCopied: action === "create" ? opts.includeImages : false,
      metafields: plan.lines,
      nutrition: {
        complete: loaded.nutrition?.complete ?? false,
        portionWeightG: loaded.nutrition?.portionWeightG ?? null,
        rows: loaded.nutrition ? nutritionRows(loaded.nutrition.per100g, loaded.nutrition.perPortion) : [],
      },
      warnings,
      blocking,
    });
  });

  return {
    preview: {
      box: { id: box.id, name: box.name },
      writesBlocked,
      blockedMessage: writesBlocked ? new ShopifyWritesBlockedError("preview").message : null,
      missingScopes: missingWriteScopes(scopes),
      includeImages: opts.includeImages,
      templates: candidates.filter(c => c.tags.every(t => t.trim().toLowerCase() !== box.name.trim().toLowerCase()))
        .map(c => ({ ...c, adminUrl: shopifyAdminUrl("products", c.productId) })),
      recipes: previews,
    },
    perRecipe,
  };
}

// ── The run ─────────────────────────────────────────────────────────────────
export interface RecipeResult {
  recipeId: number;
  recipeName: string;
  outcome: "created" | "updated" | "skipped" | "failed";
  message: string;
  product: ProductLink | null;
  steps: string[];
  linkedVariants: string[];
}
export interface RunResult {
  results: RecipeResult[];
  ticked: Ticks;
  stoppedByGuard: string | null;
}
export interface Ticks { products: boolean; collection: boolean; discount: boolean }

/** Recipe ids in a box, and which of them have a linked Shopify variant. */
export async function boxLinkState(conn: Pick<typeof db, "execute" | "select">, boxId: number): Promise<{ recipeIds: number[]; linkedRecipeIds: number[] }> {
  const recipeIds = (await conn.select({ id: testBoxRecipesTable.recipeId }).from(testBoxRecipesTable).where(eq(testBoxRecipesTable.testBoxId, boxId))).map(r => r.id);
  const linkedRecipeIds = recipeIds.length
    ? (await conn.execute<{ recipe_id: number }>(sql`SELECT DISTINCT recipe_id FROM recipe_shopify_mappings WHERE recipe_id = ANY(${intArrayLiteral(recipeIds)}::int[])`)).rows.map(r => Number(r.recipe_id))
    : [];
  return { recipeIds, linkedRecipeIds };
}

/** Tick the automated launch steps the box has now earned (never unticks):
 *  products once every recipe has a linked product, the collection and the
 *  discount code once the box holds them. */
export async function tickEarnedLaunchSteps(boxId: number, user: Actor): Promise<Ticks> {
  return db.transaction(async (tx) => {
    const [box] = await tx.select().from(testBoxesTable).where(eq(testBoxesTable.id, boxId)).for("update");
    if (!box || box.deletedAt) return { products: false, collection: false, discount: false };
    const { recipeIds, linkedRecipeIds } = await boxLinkState(tx, boxId);
    const t = { ...launchTicks({ recipeIds, linkedRecipeIds, collectionExists: box.shopifyCollectionId != null }), discount: box.discountCode != null };
    const done = new Set((await tx.execute<{ task_key: string }>(sql`SELECT task_key FROM test_box_tasks WHERE test_box_id = ${boxId} AND done`)).rows.map(r => r.task_key));
    let changed = false;
    for (const [earned, step] of [[t.products, "shopify-products"], [t.collection, "shopify-collection"], [t.discount, "discount-code"]] as const) {
      if (earned && !done.has(launchTaskKey(step))) { await tickTestBoxTask(tx, boxId, launchTaskKey(step), true, user); changed = true; }
    }
    if (changed) await syncTestBox(tx, boxId, user);
    return t;
  });
}

export async function runCreate(
  boxId: number,
  recipeIds: number[],
  opts: { templates?: Record<string, string>; includeImages: boolean },
  user: Actor,
  port: ShopifyPort,
  loadContent: ContentLoader,
  writesBlocked: boolean,
): Promise<RunResult> {
  const plan = await buildPlan(boxId, opts, port, loadContent, writesBlocked);
  // With writes blocked the guard stops the run at its first write (and says
  // so) — the dry run still goes through every read and decision first.
  if (!writesBlocked && plan.preview.missingScopes.length) {
    throw new RunRefused(409, `Shopify hasn't given the app permission to create products yet (missing: ${plan.preview.missingScopes.join(", ")}). Nothing was changed.`);
  }
  const wanted = new Set(recipeIds);
  const results: RecipeResult[] = [];
  let stoppedByGuard: string | null = null;

  for (const rp of plan.preview.recipes) {
    if (!wanted.has(rp.recipeId)) continue;
    const base = { recipeId: rp.recipeId, recipeName: rp.recipeName, steps: [] as string[], linkedVariants: [] as string[] };
    if (stoppedByGuard) { results.push({ ...base, outcome: "skipped", message: "Not attempted — Shopify writes are off", product: null }); continue; }
    if (rp.action === "linked") {
      results.push({ ...base, outcome: "skipped", message: `Already in Shopify — ${rp.linkedProducts.map(p => p.title).join(", ")}`, product: rp.linkedProducts[0] ?? null });
      continue;
    }
    if (rp.blocking.length) { results.push({ ...base, outcome: "skipped", message: rp.blocking[0], product: null }); continue; }
    const internal = plan.perRecipe.get(rp.recipeId)!;
    try {
      const res = await applyRecipeProduct(port, {
        action: rp.action,
        templateProductId: internal.template?.id ?? null,
        existingProductId: internal.createdProductId,
        title: rp.title,
        tags: rp.tags,
        descriptionHtml: internal.descriptionHtml,
        includeImages: opts.includeImages,
        content: internal.content,
        standardCooking: STANDARD_COOKING,
      }, async (productId) => {
        // Stored before anything else happens to it — a later failure can
        // never lead to a second duplicate.
        await db.insert(testBoxShopifyProductsTable).values({
          testBoxId: boxId, recipeId: rp.recipeId, shopifyProductId: productId, productTitle: rp.title,
          templateProductId: internal.template?.id ?? null, imagesCopied: opts.includeImages, state: "created",
          createdById: user.id, createdByName: user.name, updatedByName: user.name,
        }).onConflictDoUpdate({
          target: [testBoxShopifyProductsTable.testBoxId, testBoxShopifyProductsTable.recipeId],
          set: { shopifyProductId: productId, productTitle: rp.title, templateProductId: internal.template?.id ?? null, imagesCopied: opts.includeImages, state: "created", lastError: null, updatedByName: user.name, updatedAt: new Date() },
        });
      });
      await db.update(testBoxShopifyProductsTable)
        .set({ state: "complete", productTitle: res.title, lastError: null, updatedByName: user.name, updatedAt: new Date() })
        .where(and(eq(testBoxShopifyProductsTable.testBoxId, boxId), eq(testBoxShopifyProductsTable.recipeId, rp.recipeId)));

      // Link the variant(s) to the recipe so sales reach the planner.
      const toLink = variantsToLink(res.variants, internal.template?.variants ?? res.variants, internal.templateMainVariantIds);
      const conflicts: string[] = [];
      for (const vid of toLink) {
        const v = res.variants.find(x => x.id === vid)!;
        const r = await linkVariantToRecipe(db, { recipeId: rp.recipeId, shopifyVariantId: vid, shopifyProductTitle: res.title, shopifyVariantTitle: v.title, shopifySku: v.sku }, "keep");
        if (r.linked) base.linkedVariants.push(v.title); else conflicts.push(v.title);
      }
      const linkNote = conflicts.length
        ? ` The ${conflicts.join(", ")} variant is already linked to another recipe — not changed.`
        : toLink.length === 0 ? " No variant could be matched to link — link it on the recipe's Shopify mapping." : "";
      results.push({
        ...base, steps: res.steps,
        outcome: rp.action === "create" ? "created" : "updated",
        message: (rp.action === "create" ? "Made as a draft and linked to the recipe." : "Updated.") + linkNote,
        product: link({ productId: res.productId, title: res.title, status: res.status }),
      });
    } catch (err) {
      if (err instanceof ShopifyWritesBlockedError) {
        stoppedByGuard = err.message;
        results.push({ ...base, outcome: "skipped", message: err.message, product: null });
        continue;
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[test-box-shopify] box ${boxId} recipe ${rp.recipeId}:`, msg);
      await db.update(testBoxShopifyProductsTable).set({ lastError: msg.slice(0, 1000), updatedAt: new Date() })
        .where(and(eq(testBoxShopifyProductsTable.testBoxId, boxId), eq(testBoxShopifyProductsTable.recipeId, rp.recipeId)));
      results.push({ ...base, outcome: "failed", message: msg, product: null });
    }
  }

  // The collection is its own launch step now ("Create the Shopify
  // collection"), so a products run never makes it.
  const ticked = await tickEarnedLaunchSteps(boxId, user);
  return { results, ticked, stoppedByGuard };
}

/** Link an existing Shopify variant to a recipe in the box (no Shopify write). */
export async function linkExisting(
  boxId: number, recipeId: number, variantIds: string[], user: Actor, port: ShopifyPort,
): Promise<{ linked: string[]; conflicts: string[]; ticked: Ticks }> {
  const inBox = await db.select({ id: testBoxRecipesTable.id }).from(testBoxRecipesTable)
    .where(and(eq(testBoxRecipesTable.testBoxId, boxId), eq(testBoxRecipesTable.recipeId, recipeId)));
  if (!inBox.length) throw new RunRefused(404, "That recipe isn't in this box");
  const found = await fetchVariantProducts(port, variantIds);
  const linked: string[] = [];
  const conflicts: string[] = [];
  for (const vid of variantIds) {
    const v = found.get(vid);
    if (!v) { conflicts.push(`${vid} (not found in Shopify)`); continue; }
    const r = await linkVariantToRecipe(db, { recipeId, shopifyVariantId: vid, shopifyProductTitle: v.title, shopifyVariantTitle: v.variantTitle }, "keep");
    if (r.linked) linked.push(`${v.title} — ${v.variantTitle}`); else conflicts.push(`${v.title} — ${v.variantTitle} (already linked to another recipe)`);
  }
  const ticked = await tickEarnedLaunchSteps(boxId, user);
  return { linked, conflicts, ticked };
}

/** Recipes in a box (ids) — for request validation. */
export async function boxRecipeIds(boxId: number): Promise<number[]> {
  const rows = await db.select({ id: testBoxRecipesTable.recipeId }).from(testBoxRecipesTable).where(eq(testBoxRecipesTable.testBoxId, boxId));
  return rows.map(r => r.id);
}
