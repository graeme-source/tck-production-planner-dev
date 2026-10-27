/**
 * Pushes each recipe's UPF %, calories and protein per portion, and its
 * full nutrition table (per 100 g and per portion), to its Shopify product's
 * metafields, so the menu card icons and the nutrition table always match
 * the planner (Graeme, 2026-10-22; table 2026-10-24). Objective B. Decisions live in
 * upf-shopify-plan.ts; this file only reads, writes and records — see
 * migration 0214_upf_shopify_sync.sql for the why.
 *
 * Runs every 10 minutes and on demand (POST /api/upf/shopify-sync/run).
 * Writes go through shopifyGraphQLWrite, so staging / BLOCK_SHOPIFY_WRITES
 * never touch the store. Only figures that changed are written.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { schedule } from "node-cron";
import { isStaging } from "./app-env";
import { computeUpfSummary } from "./upf";
import { computeRecipeNutritionals } from "../routes/recipes";
import {
  planWebsiteSync, WEBSITE_METRICS, NUTRITION_KEYS,
  type ProductLink, type LedgerEntry, type ProductDecision, type RecipeFacts, type WebsiteMetric, type FigureValue,
} from "./upf-shopify-plan";
import { shopifyGraphQL, shopifyGraphQLWrite, ShopifyWritesBlockedError } from "../services/shopify";

/** The product metafields the theme reads (snippets/tck-card-facts.liquid). */
export const WEBSITE_METAFIELDS: Record<WebsiteMetric, { namespace: string; key: string; type: string; format: (v: FigureValue) => string }> = {
  upf: { namespace: "custom", key: "upf_percent", type: "number_decimal", format: v => Number(v).toFixed(1) },
  kcal: { namespace: "custom", key: "kcal_per_portion", type: "number_integer", format: v => String(Math.round(Number(v))) },
  protein: { namespace: "custom", key: "protein_per_portion", type: "number_decimal", format: v => Number(v).toFixed(1) },
  // The nutrition table (snippets/tck-nutrition-table.liquid): per 100 g and
  // per portion — or per 100 g only for a recipe with no pack size —
  // already JSON from nutritionPanelJson.
  nutrition: { namespace: "custom", key: "nutrition_panel", type: "json", format: v => String(v) },
};

/** Shopify takes at most 25 metafields per metafieldsSet / metafieldsDelete. */
const WRITE_BATCH = 25;
const READ_BATCH = 100;

export interface WebsiteSyncRunResult {
  ranAt: string;
  products: number;
  written: number;
  errors: string[];
  blocked: boolean;
}

let running: Promise<WebsiteSyncRunResult> | null = null;
let lastRun: WebsiteSyncRunResult | null = null;

export function lastUpfSyncRun(): WebsiteSyncRunResult | null {
  return lastRun;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Every recipe → Shopify product link (2-pack, Wonky and 8-pack variants). */
async function loadProductLinks(): Promise<ProductLink[]> {
  const rows = await db.execute<{ recipe_id: number; shopify_variant_id: string | null; wonky_variant_id: string | null; eight_pack_variant_id: string | null }>(sql`
    SELECT recipe_id, shopify_variant_id, wonky_variant_id, eight_pack_variant_id FROM recipe_shopify_mappings
  `);
  const recipesByVariant = new Map<string, number[]>();
  for (const r of rows.rows) {
    for (const v of [r.shopify_variant_id, r.wonky_variant_id, r.eight_pack_variant_id]) {
      if (!v || v.trim() === "") continue;
      const ids = recipesByVariant.get(v.trim()) ?? [];
      ids.push(r.recipe_id);
      recipesByVariant.set(v.trim(), ids);
    }
  }

  const links: ProductLink[] = [];
  for (const ids of chunk([...recipesByVariant.keys()], READ_BATCH)) {
    const res = await shopifyGraphQL<{ nodes: Array<{ id: string; product: { id: string; title: string } } | null> }>(
      `query ($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id product { id title } } } }`,
      { ids: ids.map(v => `gid://shopify/ProductVariant/${v}`) },
    );
    for (const n of res.nodes) {
      if (!n?.product) continue; // variant deleted in Shopify
      const variantId = n.id.split("/").pop()!;
      for (const recipeId of recipesByVariant.get(variantId) ?? []) {
        links.push({ productGid: n.product.id, productTitle: n.product.title, recipeId });
      }
    }
  }
  return links;
}

/** UPF rollup + nutrition panel for the recipes that are on Shopify. */
async function loadRecipeFacts(recipeIds: number[]): Promise<RecipeFacts[]> {
  const upf = new Map((await computeUpfSummary()).recipes.map(r => [r.recipeId, r]));
  const facts: RecipeFacts[] = [];
  for (const recipeId of recipeIds) {
    const u = upf.get(recipeId);
    if (!u) continue;
    const n = await computeRecipeNutritionals(recipeId);
    const lacking = (key: string) => n.completeness.missingNutritionalDetail.filter(d => (d.missing as string[]).includes(key)).map(d => d.name);
    const values = (src: Record<string, number | null>) =>
      Object.fromEntries(NUTRITION_KEYS.map(k => [k, src[k] ?? null])) as Record<(typeof NUTRITION_KEYS)[number], number | null>;
    // No pack size (migration 0286): perPortion / portionWeightG come back
    // null and the plan sends the table per 100 g only.
    const hasPortion = n.perPortion != null && n.portionWeightG != null && n.portionWeightG > 0;
    facts.push({
      recipeId,
      name: u.name,
      upfPercent: u.upfPercent,
      unclassifiedIngredients: u.unclassifiedIngredients,
      per100gOnly: n.per100gOnly,
      kcalPerPortion: hasPortion ? n.perPortion!.energyKcal : null,
      proteinPerPortion: hasPortion ? n.perPortion!.protein : null,
      missingKcal: lacking("energyKcal"),
      missingProtein: lacking("protein"),
      nutrition: n.per100gOnly
        ? { portionWeightG: null, per100g: values(n.per100g), perPortion: null }
        : hasPortion ? { portionWeightG: n.portionWeightG, per100g: values(n.per100g), perPortion: values(n.perPortion!) } : null,
      missingNutrition: n.completeness.missingNutritionalDetail.map(d => d.name),
    });
  }
  return facts;
}

async function loadLedger(): Promise<LedgerEntry[]> {
  const r = await db.execute<{ product_gid: string; product_title: string | null; upf_published: string | null; kcal_published: number | null; protein_published: string | null; nutrition_published: string | null }>(sql`
    SELECT product_gid, product_title, upf_published::text, kcal_published, protein_published::text, nutrition_published FROM upf_shopify_sync
     -- A row never written, or whose last write failed, says nothing reliable
     -- about Shopify: leave it out so the plan writes that product again.
     WHERE written_at IS NOT NULL AND last_error IS NULL
  `);
  const num = (v: string | number | null) => (v == null ? null : Number(v));
  return r.rows.map(x => ({
    productGid: x.product_gid,
    productTitle: x.product_title,
    published: { upf: num(x.upf_published), kcal: num(x.kcal_published), protein: num(x.protein_published), nutrition: x.nutrition_published },
  }));
}

type UserErrors = Array<{ field: string[] | null; message: string }>;
interface Write { productGid: string; metric: WebsiteMetric; value: FigureValue | null }

/** Applies the writes; returns per-product errors (gid → message). */
async function writeToShopify(decisions: ProductDecision[]): Promise<Map<string, string>> {
  const failed = new Map<string, string>();
  const writes: Write[] = decisions.flatMap(d =>
    WEBSITE_METRICS.filter(m => d.metrics[m].needsWrite).map(m => ({ productGid: d.productGid, metric: m, value: d.metrics[m].value })),
  );
  const fail = (batch: Write[], msg: string) => { for (const w of batch) failed.set(w.productGid, msg); };

  for (const batch of chunk(writes.filter(w => w.value !== null), WRITE_BATCH)) {
    try {
      const r = await shopifyGraphQLWrite<{ metafieldsSet: { userErrors: UserErrors } }>(
        "websiteFactsMetafieldsSet",
        `mutation ($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } } }`,
        {
          metafields: batch.map(w => {
            const f = WEBSITE_METAFIELDS[w.metric];
            return { ownerId: w.productGid, namespace: f.namespace, key: f.key, type: f.type, value: f.format(w.value!) };
          }),
        },
      );
      if (r.metafieldsSet.userErrors.length) fail(batch, r.metafieldsSet.userErrors.map(e => e.message).join("; "));
    } catch (err) {
      if (err instanceof ShopifyWritesBlockedError) throw err;
      fail(batch, err instanceof Error ? err.message : String(err));
    }
  }

  for (const batch of chunk(writes.filter(w => w.value === null), WRITE_BATCH)) {
    try {
      const r = await shopifyGraphQLWrite<{ metafieldsDelete: { userErrors: UserErrors } }>(
        "websiteFactsMetafieldsDelete",
        `mutation ($metafields: [MetafieldIdentifierInput!]!) { metafieldsDelete(metafields: $metafields) { deletedMetafields { key } userErrors { field message } } }`,
        { metafields: batch.map(w => ({ ownerId: w.productGid, namespace: WEBSITE_METAFIELDS[w.metric].namespace, key: WEBSITE_METAFIELDS[w.metric].key })) },
      );
      if (r.metafieldsDelete.userErrors.length) fail(batch, r.metafieldsDelete.userErrors.map(e => e.message).join("; "));
    } catch (err) {
      if (err instanceof ShopifyWritesBlockedError) throw err;
      fail(batch, err instanceof Error ? err.message : String(err));
    }
  }
  return failed;
}

async function record(decisions: ProductDecision[], failed: Map<string, string>, wrote: boolean): Promise<void> {
  for (const d of decisions) {
    const error = failed.get(d.productGid) ?? null;
    // The *_published columns only move when Shopify actually took the write.
    const written = wrote && !error;
    const { upf, kcal, protein, nutrition } = d.metrics;
    await db.execute(sql`
      INSERT INTO upf_shopify_sync (product_gid, product_title, recipe_names, status,
        upf_percent, upf_published, upf_held, kcal_per_portion, kcal_published, kcal_held,
        protein_per_portion, protein_published, protein_held,
        nutrition_panel, nutrition_published, nutrition_held, last_error, checked_at, written_at)
      VALUES (${d.productGid}, ${d.productTitle}, ${d.recipeNames.join(", ") || null}, ${d.status},
        ${upf.value}, ${written ? upf.value : null}, ${upf.heldBecause},
        ${kcal.value}, ${written ? kcal.value : null}, ${kcal.heldBecause},
        ${protein.value}, ${written ? protein.value : null}, ${protein.heldBecause},
        ${nutrition.value}, ${written ? nutrition.value : null}, ${nutrition.heldBecause},
        ${error}, NOW(), ${written ? sql`NOW()` : null})
      ON CONFLICT (product_gid) DO UPDATE SET
        product_title = EXCLUDED.product_title,
        recipe_names = EXCLUDED.recipe_names,
        status = EXCLUDED.status,
        upf_percent = EXCLUDED.upf_percent,
        upf_published = CASE WHEN ${written} THEN EXCLUDED.upf_published ELSE upf_shopify_sync.upf_published END,
        upf_held = EXCLUDED.upf_held,
        kcal_per_portion = EXCLUDED.kcal_per_portion,
        kcal_published = CASE WHEN ${written} THEN EXCLUDED.kcal_published ELSE upf_shopify_sync.kcal_published END,
        kcal_held = EXCLUDED.kcal_held,
        protein_per_portion = EXCLUDED.protein_per_portion,
        protein_published = CASE WHEN ${written} THEN EXCLUDED.protein_published ELSE upf_shopify_sync.protein_published END,
        protein_held = EXCLUDED.protein_held,
        nutrition_panel = EXCLUDED.nutrition_panel,
        nutrition_published = CASE WHEN ${written} THEN EXCLUDED.nutrition_published ELSE upf_shopify_sync.nutrition_published END,
        nutrition_held = EXCLUDED.nutrition_held,
        last_error = EXCLUDED.last_error,
        checked_at = NOW(),
        written_at = CASE WHEN ${written} THEN NOW() ELSE upf_shopify_sync.written_at END
    `);
  }
}

async function runOnce(): Promise<WebsiteSyncRunResult> {
  const ranAt = new Date().toISOString();
  const links = await loadProductLinks();
  const recipes = await loadRecipeFacts([...new Set(links.map(l => l.recipeId))]);
  const decisions = planWebsiteSync(recipes, links, await loadLedger());

  let failed = new Map<string, string>();
  let blocked = false;
  try {
    failed = await writeToShopify(decisions);
  } catch (err) {
    if (!(err instanceof ShopifyWritesBlockedError)) throw err;
    blocked = true;
  }
  await record(decisions, failed, !blocked);

  return {
    ranAt,
    products: decisions.filter(d => d.status !== "unlinked").length,
    written: blocked ? 0 : decisions.filter(d => !failed.has(d.productGid) && WEBSITE_METRICS.some(m => d.metrics[m].needsWrite)).length,
    errors: [...new Set(failed.values())],
    blocked,
  };
}

/** One sync at a time; a second caller shares the run already going. */
export function runUpfShopifySync(): Promise<WebsiteSyncRunResult> {
  if (!running) {
    running = runOnce()
      .then(r => { lastRun = r; return r; })
      .finally(() => { running = null; });
  }
  return running;
}

export function startUpfShopifySync(): void {
  if (isStaging()) {
    console.log("[upf-sync] staging: job disabled");
    return;
  }
  const tick = () => {
    runUpfShopifySync()
      .then(r => { if (r.written || r.errors.length) console.log(`[upf-sync] updated ${r.written} product(s), ${r.errors.length} error(s)`); })
      .catch(err => console.warn("[upf-sync] run failed:", err));
  };
  schedule("*/10 * * * *", tick, { timezone: "Europe/London" });
  setTimeout(tick, 3 * 60_000).unref();
  console.log("[upf-sync] UPF %, kcal, protein and nutrition table → Shopify every 10 minutes");
}
