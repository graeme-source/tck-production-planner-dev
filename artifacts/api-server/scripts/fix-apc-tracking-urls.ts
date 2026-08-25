#!/usr/bin/env tsx
/**
 * fix-apc-tracking-urls.ts
 *
 * Repairs the customer tracking links broken between 2026-08-21 and
 * 2026-08-25: createShipment stamped the Hypaship back-office URL
 * (apc.hypaship.com/tracking?waybill=…, 404 for the public) instead of the
 * apc.co.uk customer link, that value was stored on apc_consignments, and
 * it then beat the correct fulfil-time URL — so every auto-booked order's
 * shipping email carried a dead link. The code fix lives in
 * services/apc.ts (createShipment now uses apcTrackingUrl); this script
 * repairs the DATA:
 *
 *   1. apc_consignments.tracking_url — rewrites every hypaship-portal URL
 *      to apcTrackingUrl(waybill, consignee_postcode). Fixes what future
 *      reuse paths (reused consignments, batch summaries) hand out.
 *   2. --shopify: updates the tracking URL on the affected Shopify
 *      fulfilments (GraphQL fulfillmentTrackingInfoUpdate,
 *      notifyCustomer: false — no re-send, no customer email). This fixes
 *      the "Track your order" flow on the order-status page and any click
 *      that goes through Shopify; the raw URL already sitting in sent
 *      emails is beyond reach, but those customers land on a 404 today
 *      either way — after this, support can point them at the status page.
 *
 * Dry run (default — prints what would change, writes nothing):
 *   DATABASE_URL=... pnpm --filter @workspace/api-server exec tsx \
 *     scripts/fix-apc-tracking-urls.ts [--shopify]
 *
 * Apply:
 *   ... scripts/fix-apc-tracking-urls.ts --apply [--shopify]
 *
 * The Shopify pass honours BLOCK_SHOPIFY_WRITES (same guard as the app)
 * and needs the .env Shopify credentials. Outward-facing: run against
 * live only with Graeme's explicit approval.
 */

import { pool } from "@workspace/db";
import { apcTrackingUrl } from "../src/services/apc";
import { shopifyFetchRaw, shopifyGraphQL, parseNextPageInfo } from "../src/services/shopify";
import { shouldSkipSideEffect } from "../src/lib/app-env";

const APPLY = process.argv.includes("--apply");
const DO_SHOPIFY = process.argv.includes("--shopify");
const BAD_URL_MARKER = "hypaship.com/tracking";
// First day the bad URL shipped (batch booking went live 2026-08-21); a
// day's margin on either side costs nothing.
const SHOPIFY_SCAN_FROM = "2026-08-20T00:00:00Z";

async function fixConsignments() {
  const { rows } = await pool.query<{ id: number; waybill: string; consignee_postcode: string | null; tracking_url: string }>(
    `SELECT id, waybill, consignee_postcode, tracking_url
     FROM apc_consignments
     WHERE tracking_url LIKE '%' || $1 || '%'
     ORDER BY id`,
    [BAD_URL_MARKER],
  );
  console.log(`\napc_consignments: ${rows.length} row(s) carry the Hypaship portal URL`);
  const postcodeByWaybill = new Map<string, string | null>();
  for (const r of rows) {
    const fixed = apcTrackingUrl(r.waybill, r.consignee_postcode);
    postcodeByWaybill.set(r.waybill, r.consignee_postcode);
    console.log(`  #${r.id} ${r.waybill}: ${r.tracking_url} -> ${fixed}`);
    if (APPLY) {
      await pool.query(`UPDATE apc_consignments SET tracking_url = $1 WHERE id = $2`, [fixed, r.id]);
    }
  }
  if (APPLY && rows.length) console.log(`  updated ${rows.length} row(s).`);
  return postcodeByWaybill;
}

async function fixShopifyFulfilments(postcodeByWaybill: Map<string, string | null>) {
  // The scan is read-only, so a dry run may proceed anywhere; the guard
  // only has to stop actual mutations.
  if (APPLY && shouldSkipSideEffect()) {
    console.log("\nShopify pass SKIPPED: BLOCK_SHOPIFY_WRITES is set in this environment.");
    return;
  }
  interface OrderRow {
    id: number; name: string;
    shipping_address?: { zip?: string | null } | null;
    fulfillments?: Array<{
      id: number; admin_graphql_api_id?: string; tracking_number: string | null;
      tracking_url: string | null; tracking_company: string | null;
    }>;
  }
  let pageInfo: string | null = null;
  let scanned = 0, bad = 0, fixed = 0;
  do {
    const params: Record<string, string> = pageInfo
      ? { limit: "250", page_info: pageInfo, fields: "id,name,shipping_address,fulfillments" }
      : {
          // updated_at_min, NOT created_at_min: orders are often placed days
          // before dispatch (delivery-date pre-orders), so filtering by
          // creation date misses orders created earlier but fulfilled inside
          // the bad-URL window. Fulfilling updates the order, so
          // updated_at_min catches them all.
          limit: "250", status: "any", updated_at_min: SHOPIFY_SCAN_FROM,
          fields: "id,name,shipping_address,fulfillments",
        };
    const res = await shopifyFetchRaw("/orders.json", params);
    if (!res.ok) throw new Error(`Shopify orders fetch failed: ${res.status}`);
    const { orders } = (await res.json()) as { orders: OrderRow[] };
    pageInfo = parseNextPageInfo(res.headers.get("link"));
    for (const o of orders) {
      for (const f of o.fulfillments ?? []) {
        scanned++;
        if (!f.tracking_url?.includes(BAD_URL_MARKER) || !f.tracking_number) continue;
        bad++;
        const postcode = postcodeByWaybill.get(f.tracking_number) ?? o.shipping_address?.zip ?? null;
        const goodUrl = apcTrackingUrl(f.tracking_number, postcode);
        console.log(`  ${o.name} fulfilment ${f.id}: -> ${goodUrl}${APPLY ? "" : " (dry run)"}`);
        if (!APPLY) continue;
        const gid = f.admin_graphql_api_id ?? `gid://shopify/Fulfillment/${f.id}`;
        const result = await shopifyGraphQL<{
          fulfillmentTrackingInfoUpdate: { fulfillment: { id: string } | null; userErrors: Array<{ message: string }> };
        }>(
          `mutation fixTracking($fulfillmentId: ID!, $trackingInfoInput: FulfillmentTrackingInput!, $notifyCustomer: Boolean) {
            fulfillmentTrackingInfoUpdate(fulfillmentId: $fulfillmentId, trackingInfoInput: $trackingInfoInput, notifyCustomer: $notifyCustomer) {
              fulfillment { id }
              userErrors { field message }
            }
          }`,
          {
            fulfillmentId: gid,
            trackingInfoInput: {
              number: f.tracking_number,
              company: f.tracking_company ?? "APC Overnight",
              url: goodUrl,
            },
            notifyCustomer: false,
          },
        );
        const errs = result.fulfillmentTrackingInfoUpdate?.userErrors ?? [];
        if (errs.length) {
          console.error(`    FAILED ${o.name}: ${errs.map(e => e.message).join("; ")}`);
        } else {
          fixed++;
        }
      }
    }
  } while (pageInfo);
  console.log(`\nShopify: scanned ${scanned} fulfilment(s), ${bad} bad, ${APPLY ? `${fixed} fixed` : "0 written (dry run)"}.`);
}

async function main() {
  console.log(`APC tracking URL repair — ${APPLY ? "APPLY" : "DRY RUN"}${DO_SHOPIFY ? " + Shopify pass" : " (DB only; add --shopify for fulfilments)"}`);
  const postcodes = await fixConsignments();
  if (DO_SHOPIFY) await fixShopifyFulfilments(postcodes);
  console.log("\nDone.");
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
