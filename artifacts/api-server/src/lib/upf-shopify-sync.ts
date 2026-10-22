/**
 * Pushes each recipe's UPF % to its Shopify product (metafield
 * custom.upf_percent), so the website's UPF row always matches the planner
 * (Graeme, 2026-10-22). Objective B. Decisions live in upf-shopify-plan.ts;
 * this file only reads, writes and records — see migration
 * 0214_upf_shopify_sync.sql for the why.
 *
 * Runs every 10 minutes and on demand (POST /api/upf/shopify-sync/run).
 * Writes go through shopifyGraphQLWrite, so staging / BLOCK_SHOPIFY_WRITES
 * never touch the store. Only products whose number changed are written.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { schedule } from "node-cron";
import { isStaging } from "./app-env";
import { computeUpfSummary } from "./upf";
import { planUpfSync, type ProductLink, type LedgerEntry, type UpfDecision } from "./upf-shopify-plan";
import { shopifyGraphQL, shopifyGraphQLWrite, ShopifyWritesBlockedError } from "../services/shopify";

export const UPF_METAFIELD = { namespace: "custom", key: "upf_percent", type: "number_decimal" } as const;

/** Shopify takes at most 25 metafields per metafieldsSet / metafieldsDelete. */
const WRITE_BATCH = 25;
const READ_BATCH = 100;

export interface UpfSyncRunResult {
  ranAt: string;
  products: number;
  published: number;
  held: number;
  written: number;
  errors: string[];
  blocked: boolean;
}

let running: Promise<UpfSyncRunResult> | null = null;
let lastRun: UpfSyncRunResult | null = null;

export function lastUpfSyncRun(): UpfSyncRunResult | null {
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
  const recipeByVariant = new Map<string, number[]>();
  for (const r of rows.rows) {
    for (const v of [r.shopify_variant_id, r.wonky_variant_id, r.eight_pack_variant_id]) {
      if (!v || v.trim() === "") continue;
      const list = recipeByVariant.get(v.trim()) ?? [];
      list.push(r.recipe_id);
      recipeByVariant.set(v.trim(), list);
    }
  }

  const links: ProductLink[] = [];
  for (const ids of chunk([...recipeByVariant.keys()], READ_BATCH)) {
    const res = await shopifyGraphQL<{ nodes: Array<{ id: string; product: { id: string; title: string } } | null> }>(
      `query ($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id product { id title } } } }`,
      { ids: ids.map(v => `gid://shopify/ProductVariant/${v}`) },
    );
    for (const n of res.nodes) {
      if (!n?.product) continue; // variant deleted in Shopify
      const variantId = n.id.split("/").pop()!;
      for (const recipeId of recipeByVariant.get(variantId) ?? []) {
        links.push({ productGid: n.product.id, productTitle: n.product.title, recipeId });
      }
    }
  }
  return links;
}

async function loadLedger(): Promise<LedgerEntry[]> {
  const r = await db.execute<{ product_gid: string; product_title: string | null; published_percent: string | null }>(sql`
    SELECT product_gid, product_title, published_percent::text FROM upf_shopify_sync
     -- A row never written, or whose last write failed, says nothing reliable
     -- about Shopify: leave it out so the plan writes that product again.
     WHERE written_at IS NOT NULL AND last_error IS NULL
  `);
  return r.rows.map(x => ({
    productGid: x.product_gid,
    productTitle: x.product_title,
    publishedPercent: x.published_percent == null ? null : Number(x.published_percent),
  }));
}

type UserErrors = Array<{ field: string[] | null; message: string }>;

/** Applies the writes; returns per-product errors (gid → message). */
async function writeToShopify(decisions: UpfDecision[]): Promise<Map<string, string>> {
  const failed = new Map<string, string>();
  const toSet = decisions.filter(d => d.needsWrite && d.percent !== null);
  const toRemove = decisions.filter(d => d.needsWrite && d.percent === null);

  for (const batch of chunk(toSet, WRITE_BATCH)) {
    try {
      const r = await shopifyGraphQLWrite<{ metafieldsSet: { userErrors: UserErrors } }>(
        "upfMetafieldsSet",
        `mutation ($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } } }`,
        { metafields: batch.map(d => ({ ownerId: d.productGid, ...UPF_METAFIELD, value: d.percent!.toFixed(1) })) },
      );
      if (r.metafieldsSet.userErrors.length) {
        const msg = r.metafieldsSet.userErrors.map(e => e.message).join("; ");
        for (const d of batch) failed.set(d.productGid, msg);
      }
    } catch (err) {
      if (err instanceof ShopifyWritesBlockedError) throw err;
      for (const d of batch) failed.set(d.productGid, err instanceof Error ? err.message : String(err));
    }
  }

  for (const batch of chunk(toRemove, WRITE_BATCH)) {
    try {
      const r = await shopifyGraphQLWrite<{ metafieldsDelete: { userErrors: UserErrors } }>(
        "upfMetafieldsDelete",
        `mutation ($metafields: [MetafieldIdentifierInput!]!) { metafieldsDelete(metafields: $metafields) { deletedMetafields { key } userErrors { field message } } }`,
        { metafields: batch.map(d => ({ ownerId: d.productGid, namespace: UPF_METAFIELD.namespace, key: UPF_METAFIELD.key })) },
      );
      if (r.metafieldsDelete.userErrors.length) {
        const msg = r.metafieldsDelete.userErrors.map(e => e.message).join("; ");
        for (const d of batch) failed.set(d.productGid, msg);
      }
    } catch (err) {
      if (err instanceof ShopifyWritesBlockedError) throw err;
      for (const d of batch) failed.set(d.productGid, err instanceof Error ? err.message : String(err));
    }
  }
  return failed;
}

async function record(decisions: UpfDecision[], failed: Map<string, string>, wrote: boolean): Promise<void> {
  for (const d of decisions) {
    const error = failed.get(d.productGid) ?? null;
    const written = wrote && d.needsWrite && !error;
    // published_percent only moves when Shopify actually took the write.
    await db.execute(sql`
      INSERT INTO upf_shopify_sync (product_gid, product_title, recipe_names, status, upf_percent, published_percent, unclassified, last_error, checked_at, written_at)
      VALUES (${d.productGid}, ${d.productTitle}, ${d.recipeNames.join(", ") || null}, ${d.status}, ${d.percent},
              ${written ? d.percent : null}, ${d.unclassified.join(", ") || null}, ${error}, NOW(), ${written ? sql`NOW()` : null})
      ON CONFLICT (product_gid) DO UPDATE SET
        product_title = EXCLUDED.product_title,
        recipe_names = EXCLUDED.recipe_names,
        status = EXCLUDED.status,
        upf_percent = EXCLUDED.upf_percent,
        published_percent = CASE WHEN ${written} THEN EXCLUDED.published_percent ELSE upf_shopify_sync.published_percent END,
        unclassified = EXCLUDED.unclassified,
        last_error = EXCLUDED.last_error,
        checked_at = NOW(),
        written_at = CASE WHEN ${written} THEN NOW() ELSE upf_shopify_sync.written_at END
    `);
  }
}

async function runOnce(): Promise<UpfSyncRunResult> {
  const ranAt = new Date().toISOString();
  const summary = await computeUpfSummary();
  const recipes = summary.recipes.map(r => ({
    recipeId: r.recipeId,
    name: r.name,
    upfPercent: r.upfPercent,
    unclassifiedIngredients: r.unclassifiedIngredients,
  }));
  const decisions = planUpfSync(recipes, await loadProductLinks(), await loadLedger());

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
    published: decisions.filter(d => d.status === "published").length,
    held: decisions.filter(d => d.status.startsWith("held_")).length,
    written: blocked ? 0 : decisions.filter(d => d.needsWrite && !failed.has(d.productGid)).length,
    errors: [...new Set(failed.values())],
    blocked,
  };
}

/** One sync at a time; a second caller shares the run already going. */
export function runUpfShopifySync(): Promise<UpfSyncRunResult> {
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
      .then(r => { if (r.written || r.errors.length) console.log(`[upf-sync] wrote ${r.written}, ${r.errors.length} error(s)`); })
      .catch(err => console.warn("[upf-sync] run failed:", err));
  };
  schedule("*/10 * * * *", tick, { timezone: "Europe/London" });
  setTimeout(tick, 3 * 60_000).unref();
  console.log("[upf-sync] UPF % → Shopify every 10 minutes");
}
