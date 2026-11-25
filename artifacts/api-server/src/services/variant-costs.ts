/**
 * Giving a Shopify product with no cost a cost, from Order Analysis's order
 * pop-up (Graeme, 25 Nov 2026). Three ways, each a link the costing already
 * reads (lib/pnl-calculator.ts, in this order):
 *
 *   1. It's one of our recipes — its main, F2F or wonky product.
 *   2. It's a supply we buy in — pack cost ÷ the Shopify items in a pack.
 *   3. A cost set by hand — shopify_variant_costs (migration 0398), and,
 *      if asked, Shopify's own "cost per item" too (live server only).
 *
 * The rules are in lib/variant-cost-rules.ts. Objective I.
 */
import { db, ingredientsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { linkVariantToRecipe } from "../lib/recipe-shopify-mapping";
import { setRecipeF2fLink } from "../lib/recipe-f2f-link";
import { forgetRecipeMappings } from "../lib/pnl-calculator";
import { afterListingLinked, type Actor } from "../lib/barcode-store";
import { shopifyCostString, shopifyCostTickDefault, supplyLinkCost, wonkyTarget, type MainMappingRow } from "../lib/variant-cost-rules";
import { getVariantCosts, getVariantSkus, setVariantUnitCost, shopifyCostWritesAllowed, ShopifyWritesBlockedError } from "./shopify";

export type Fail = { ok: false; status: 400 | 404 | 409; error: string; reason?: string };

// ── Where a variant stands ──────────────────────────────────────────────

export interface RecipeLinkInfo { recipeId: number; name: string; kind: "main" | "wonky" | "f2f" }

async function recipeLinksOf(variantId: string): Promise<RecipeLinkInfo[]> {
  const r = await db.execute<{ id: number; name: string; kind: RecipeLinkInfo["kind"] }>(sql`
    SELECT r.id, r.name, 'main' AS kind FROM recipe_shopify_mappings m JOIN recipes r ON r.id = m.recipe_id WHERE m.shopify_variant_id = ${variantId}
    UNION ALL
    SELECT r.id, r.name, 'wonky' FROM recipe_shopify_mappings m JOIN recipes r ON r.id = m.recipe_id WHERE m.wonky_variant_id = ${variantId}
    UNION ALL
    SELECT id, name, 'f2f' FROM recipes WHERE f2f_variant_id = ${variantId}
  `);
  return r.rows.map(x => ({ recipeId: Number(x.id), name: x.name.trim(), kind: x.kind }));
}

async function supplyLinkOf(variantId: string): Promise<{ id: number; name: string } | null> {
  const [row] = await db.select({ id: ingredientsTable.id, name: ingredientsTable.name }).from(ingredientsTable).where(eq(ingredientsTable.shopifyVariantId, variantId)).limit(1);
  return row ? { id: row.id, name: row.name.trim() } : null;
}

async function manualCostOf(variantId: string) {
  const r = await db.execute<{ cost: string; category: string; set_by_name: string | null; set_at: string }>(sql`
    SELECT cost::text, category, set_by_name, set_at::text FROM shopify_variant_costs WHERE variant_id = ${variantId}
  `);
  const row = r.rows[0];
  return row ? { cost: Number(row.cost), category: row.category, setByName: row.set_by_name, setAt: row.set_at } : null;
}

/** What the pop-up's panel needs: how (if at all) it's costed now, and Shopify's cost. */
export async function variantCostStatus(variantId: string) {
  const [recipes, supply, manual] = await Promise.all([recipeLinksOf(variantId), supplyLinkOf(variantId), manualCostOf(variantId)]);
  let shopifyCost: number | null = null;
  let shopifyReadFailed = false;
  try {
    shopifyCost = (await getVariantCosts([variantId])).get(variantId) ?? null;
  } catch (err) {
    shopifyReadFailed = true;
    console.warn("[variant-costs] Shopify cost read failed:", err instanceof Error ? err.message : err);
  }
  return {
    variantId,
    recipe: recipes[0] ?? null,
    supply,
    manual,
    shopifyCost,
    shopifyReadFailed,
    /** Tick "also set it in Shopify" by default only when Shopify has none. */
    shopifyTickDefault: !shopifyReadFailed && shopifyCostTickDefault(shopifyCost),
    shopifyWritesAllowed: shopifyCostWritesAllowed(),
  };
}

/** A recipe or supply link already costs it — this isn't the place to change that. */
async function alreadyLinked(variantId: string): Promise<Fail | null> {
  const [recipes, supply] = await Promise.all([recipeLinksOf(variantId), supplyLinkOf(variantId)]);
  const r = recipes[0];
  if (r) return { ok: false, status: 409, error: `This product is already linked to the recipe ${r.name}${r.kind === "main" ? "" : ` (as its ${r.kind === "f2f" ? "F2F" : "wonky"} product)`}.` };
  if (supply) return { ok: false, status: 409, error: `This product is already linked to the supply ${supply.name}.` };
  return null;
}

// ── The lists to pick from ──────────────────────────────────────────────

export async function variantCostOptions() {
  const [recipes, mains, supplies] = await Promise.all([
    db.execute<{ id: number; name: string; f2f_variant_id: string | null; f2f_product_title: string | null; is_draft: boolean }>(sql`
      SELECT id, name, f2f_variant_id, f2f_product_title, is_draft FROM recipes WHERE archived_at IS NULL ORDER BY name`),
    db.execute<{ id: number; recipe_id: number; shopify_variant_id: string; shopify_product_title: string | null; shopify_variant_title: string | null; wonky_variant_id: string | null; wonky_product_title: string | null }>(sql`
      SELECT id, recipe_id, shopify_variant_id, shopify_product_title, shopify_variant_title, wonky_variant_id, wonky_product_title
        FROM recipe_shopify_mappings ORDER BY created_at`),
    db.select({
      id: ingredientsTable.id, name: ingredientsTable.name, unit: ingredientsTable.unit, category: ingredientsTable.category,
      costPerPack: ingredientsTable.costPerPack, shopifyVariantId: ingredientsTable.shopifyVariantId,
      shopifyProductTitle: ingredientsTable.shopifyProductTitle, shopifyUnitsPerPack: ingredientsTable.shopifyUnitsPerPack,
    }).from(ingredientsTable).orderBy(ingredientsTable.name),
  ]);
  const byRecipe = new Map<number, typeof mains.rows>();
  for (const m of mains.rows) byRecipe.set(Number(m.recipe_id), [...(byRecipe.get(Number(m.recipe_id)) ?? []), m]);
  return {
    recipes: recipes.rows.map(r => ({
      id: Number(r.id),
      name: r.name.trim(),
      isDraft: !!r.is_draft,
      f2f: r.f2f_variant_id ? { variantId: r.f2f_variant_id, title: r.f2f_product_title } : null,
      mains: (byRecipe.get(Number(r.id)) ?? []).map(m => ({
        id: Number(m.id),
        variantId: m.shopify_variant_id,
        title: [m.shopify_product_title, m.shopify_variant_title && m.shopify_variant_title !== "Default Title" ? m.shopify_variant_title : null].filter(Boolean).join(" – ") || null,
        wonky: m.wonky_variant_id ? { variantId: m.wonky_variant_id, title: m.wonky_product_title } : null,
      })),
    })),
    supplies: supplies.map(s => ({
      id: s.id,
      name: s.name.trim(),
      unit: s.unit,
      category: s.category,
      costPerPack: Number(s.costPerPack) > 0 ? Number(s.costPerPack) : null,
      shopify: s.shopifyVariantId ? { variantId: s.shopifyVariantId, title: s.shopifyProductTitle, unitsPerPack: s.shopifyUnitsPerPack != null ? Number(s.shopifyUnitsPerPack) : null } : null,
    })),
  };
}

// ── 1. It's one of our recipes ──────────────────────────────────────────

/** The SKU read the recipe page does after linking (packing checklist order). Best-effort. */
async function syncSku(variantId: string): Promise<void> {
  try {
    const sku = (await getVariantSkus([variantId])).get(variantId);
    if (sku) await db.execute(sql`UPDATE recipe_shopify_mappings SET shopify_sku = ${sku} WHERE shopify_variant_id = ${variantId}`);
  } catch (err) {
    console.warn("[variant-costs] shopify_sku sync failed:", err instanceof Error ? err.message : err);
  }
}

export async function linkVariantAsRecipe(
  variantId: string,
  b: { recipeId: number; kind: "main" | "f2f" | "wonky"; mappingId?: number | null; title: string },
  actor: Actor,
): Promise<{ ok: true; recipeName: string } | Fail> {
  const blocked = await alreadyLinked(variantId);
  if (blocked) return blocked;
  const rec = await db.execute<{ id: number; name: string }>(sql`SELECT id, name FROM recipes WHERE id = ${b.recipeId} AND archived_at IS NULL`);
  const recipe = rec.rows[0];
  if (!recipe) return { ok: false, status: 404, error: "No such recipe" };
  const recipeName = recipe.name.trim();

  if (b.kind === "f2f") {
    const cur = await db.execute<{ f2f_variant_id: string | null; f2f_product_title: string | null }>(sql`SELECT f2f_variant_id, f2f_product_title FROM recipes WHERE id = ${b.recipeId}`);
    const existing = cur.rows[0]?.f2f_variant_id;
    if (existing && existing !== variantId) {
      return { ok: false, status: 409, error: `${recipeName} already has an F2F product (${cur.rows[0]?.f2f_product_title ?? existing}). Change it on Recipes → F2F links.` };
    }
    const r = await setRecipeF2fLink(b.recipeId, { variantId, productTitle: b.title, variantTitle: null });
    if (!r.ok) return r;
  } else if (b.kind === "main") {
    const r = await linkVariantToRecipe(db, { recipeId: b.recipeId, shopifyVariantId: variantId, shopifyProductTitle: b.title }, "keep");
    if (!r.linked) return { ok: false, status: 409, error: "That Shopify product is already linked to another recipe." };
  } else {
    const rows = await db.execute<{ id: number; shopify_variant_id: string; shopify_product_title: string | null; wonky_variant_id: string | null }>(sql`
      SELECT id, shopify_variant_id, shopify_product_title, wonky_variant_id FROM recipe_shopify_mappings WHERE recipe_id = ${b.recipeId} ORDER BY created_at`);
    const mains: MainMappingRow[] = rows.rows.map(x => ({ id: Number(x.id), variantId: x.shopify_variant_id, title: x.shopify_product_title, wonkyVariantId: x.wonky_variant_id }));
    const t = wonkyTarget(mains, variantId, b.mappingId);
    if (!t.ok) return { ok: false, status: 409, error: t.message, reason: t.reason };
    await db.execute(sql`
      UPDATE recipe_shopify_mappings SET wonky_variant_id = ${variantId}, wonky_product_title = ${b.title}, wonky_variant_title = NULL
       WHERE id = ${t.mappingId} AND recipe_id = ${b.recipeId}`);
  }
  forgetRecipeMappings();
  if (b.kind === "main") await syncSku(variantId);
  if (b.kind !== "f2f") {
    // As the recipe page does after a link: a held barcode goes onto the listing.
    await afterListingLinked(b.recipeId, actor).catch(err => console.error("[variant-costs] barcode after linking failed:", err));
  }
  console.log(`[variant-costs] ${actor.name ?? `user ${actor.id}`} linked Shopify variant ${variantId} ("${b.title}") to recipe ${b.recipeId} ${recipeName} as ${b.kind}`);
  return { ok: true, recipeName };
}

// ── 2. It's a supply we buy in ──────────────────────────────────────────

export async function linkVariantAsSupply(
  variantId: string,
  b: { ingredientId: number; unitsPerPack: number; costPerPack?: number | null; title: string },
  actor: Actor,
): Promise<{ ok: true; supplyName: string; costPerPack: number } | Fail> {
  const blocked = await alreadyLinked(variantId);
  if (blocked) return blocked;
  const [ing] = await db.select({
    id: ingredientsTable.id, name: ingredientsTable.name, costPerPack: ingredientsTable.costPerPack,
    shopifyVariantId: ingredientsTable.shopifyVariantId, shopifyProductTitle: ingredientsTable.shopifyProductTitle,
  }).from(ingredientsTable).where(eq(ingredientsTable.id, b.ingredientId));
  if (!ing) return { ok: false, status: 404, error: "No such supply" };
  const name = ing.name.trim();
  if (ing.shopifyVariantId && ing.shopifyVariantId !== variantId) {
    return { ok: false, status: 409, error: `${name} is already linked to the Shopify product ${ing.shopifyProductTitle ?? ing.shopifyVariantId}. A supply has one Shopify product — change it on the supply's page.` };
  }
  const cost = supplyLinkCost(Number(ing.costPerPack), b.costPerPack);
  if (!cost.ok) return { ok: false, status: 400, error: cost.message, reason: "needs-cost" };
  await db.update(ingredientsTable).set({
    shopifyVariantId: variantId,
    shopifyProductTitle: b.title,
    shopifyVariantTitle: null,
    shopifyUnitsPerPack: String(b.unitsPerPack),
    ...(cost.setsCost ? { costPerPack: String(cost.costPerPack) } : {}),
  }).where(eq(ingredientsTable.id, b.ingredientId));
  console.log(`[variant-costs] ${actor.name ?? `user ${actor.id}`} linked Shopify variant ${variantId} ("${b.title}") to supply ${b.ingredientId} ${name}, ${b.unitsPerPack} per pack${cost.setsCost ? `, cost per pack set to £${cost.costPerPack}` : ""}`);
  return { ok: true, supplyName: name, costPerPack: cost.costPerPack };
}

// ── 3. A cost set by hand ───────────────────────────────────────────────

export type ShopifyWriteOutcome =
  | { status: "not-asked" }
  | { status: "written"; cost: string }
  | { status: "blocked" | "failed" | "skipped"; message: string };

export async function setManualVariantCost(
  variantId: string,
  b: { cost: number; category: "food" | "packaging"; title: string; alsoShopify: boolean },
  actor: Actor,
): Promise<{ ok: true; shopify: ShopifyWriteOutcome } | Fail> {
  const blocked = await alreadyLinked(variantId);
  if (blocked) return blocked;
  // The app's cost first: a failed Shopify write never undoes it.
  await db.execute(sql`
    INSERT INTO shopify_variant_costs (variant_id, title, cost, category, set_by, set_by_name, set_at)
    VALUES (${variantId}, ${b.title}, ${b.cost}, ${b.category}, ${actor.id}, ${actor.name}, NOW())
    ON CONFLICT (variant_id) DO UPDATE SET
      title = EXCLUDED.title, cost = EXCLUDED.cost, category = EXCLUDED.category,
      set_by = EXCLUDED.set_by, set_by_name = EXCLUDED.set_by_name, set_at = EXCLUDED.set_at
  `);
  console.log(`[variant-costs] ${actor.name ?? `user ${actor.id}`} set the cost of Shopify variant ${variantId} ("${b.title}") to £${b.cost} (${b.category})${b.alsoShopify ? ", and asked for Shopify's too" : ""}`);

  let shopify: ShopifyWriteOutcome = { status: "not-asked" };
  if (b.alsoShopify) {
    const value = shopifyCostString(b.cost);
    if (!value) {
      shopify = { status: "skipped", message: "Shopify holds costs to the penny, and this is under half a penny, so it's kept in the app only." };
    } else {
      try {
        await setVariantUnitCost(variantId, value);
        shopify = { status: "written", cost: value };
        console.log(`[variant-costs] Shopify cost per item for variant ${variantId} set to £${value}`);
      } catch (err) {
        if (err instanceof ShopifyWritesBlockedError) {
          shopify = { status: "blocked", message: "Not sent to Shopify: Shopify writes only happen on the live app, and this isn't it. The cost is saved in the app." };
        } else {
          console.error(`[variant-costs] Shopify cost write failed for variant ${variantId}:`, err);
          shopify = { status: "failed", message: `Shopify didn't take it (${err instanceof Error ? err.message.slice(0, 160) : "unknown error"}). The cost is saved in the app.` };
        }
      }
    }
  }
  return { ok: true, shopify };
}
