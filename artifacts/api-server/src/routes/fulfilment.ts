import { Router, type Request, type Response, type NextFunction } from "express";
import { db, skuLocationsTable, skuBarcodesTable, appSettingsTable, usersTable, shopifyFulfilmentTrackingTable, apcConsignmentsTable, pagePermissionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import * as z from "zod";
import { getUnfulfilledOrdersByTag, getOrdersByTag, getRecentUnfulfilledOrders, fulfillOrder, getProducts, getProductsByTag, findOrderByName, addTagToOrder, replaceTagOnOrder, getOrderById, getVariantBarcodes, shopifyGraphQL, type ShopifyOrder, type ShopifyLineItem } from "../services/shopify";
import { createShipment, addParcel, cancelShipment, fetchLabel, isConfigured as isApcConfigured, trainingCredentialsConfigured, APC_TRAINING_BASE, checkPostcodeService, lookupOrderByReference, lookupOrdersByReference, lookupOrderByWaybill, parseApcBarcode, waybillCore, apcTrackingUrl, type ApcOrderLookup } from "../services/apc";
import { decrementFridgeForShopifyOrder } from "../lib/inventory-sync";
import { sql } from "drizzle-orm";

const router = Router();

/** Who is booking — recorded against each consignment so the end-of-day
 *  report can say who raised what. */
async function resolveUserName(req: Request): Promise<string> {
  if (!req.session.userId) return "unknown";
  const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.session.userId));
  return user?.name ?? `user ${req.session.userId}`;
}

async function resolveRole(req: Request): Promise<"admin" | "manager" | "viewer" | null> {
  if (req.session.userRole) return req.session.userRole as "admin" | "manager" | "viewer";
  if (!req.session.userId) return null;
  const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.session.userId));
  if (user) {
    req.session.userRole = user.role as "admin" | "manager" | "viewer";
    return req.session.userRole;
  }
  return null;
}

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const role = await resolveRole(req);
  if (role === "admin") { next(); return; }
  res.status(403).json({ error: "Admin access required" });
}

const ROLE_RANK: Record<string, number> = { viewer: 0, manager: 1, admin: 2 };

// Operational fulfilment endpoints (list orders, verify labels, complete)
// honour the "/fulfilment" page permission set in Settings → Page Access
// Control, so opening Order Packing Live to viewers there also opens the
// API the page needs — one knob, not two. No stored row falls back to
// "manager", matching the default the page-permissions route serves.
// Admin-only endpoints (config, barcode sync, probes) stay requireAdmin.
async function requireFulfilmentAccess(req: Request, res: Response, next: NextFunction) {
  const role = await resolveRole(req);
  if (role) {
    const [row] = await db
      .select({ minRole: pagePermissionsTable.minRole })
      .from(pagePermissionsTable)
      .where(eq(pagePermissionsTable.pageKey, "/fulfilment"));
    const minRole = row?.minRole ?? "manager";
    if ((ROLE_RANK[role] ?? 0) >= (ROLE_RANK[minRole] ?? 1)) { next(); return; }
  }
  res.status(403).json({ error: "Your role doesn't have access to Order Packing Live — an admin can change this under Settings → Page Access Control" });
}

async function getAppSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, key));
  return row?.value ?? null;
}

/**
 * Courier integration mode.
 *
 *   "off"       — no courier integration; Shopify is fulfilled without tracking
 *   "reconcile" — consignments are raised BY HAND in Hypaship (bulk CSV) with
 *                 the Shopify order name as the reference. The app looks the
 *                 consignment up, makes the packer scan the printed label to
 *                 prove it's the right one, then writes that waybill to
 *                 Shopify. No consignments are booked and no labels printed.
 *   "full"      — the app books consignments and prints labels via the API.
 *
 * Falls back to the legacy apc_enabled boolean when apc_mode is unset, so an
 * environment that hasn't run the seed keeps its existing behaviour.
 */
export type ApcMode = "off" | "reconcile" | "full";

/** Stamp the ledger row once Shopify has actually accepted the tracking
 *  number. Never throws — a bookkeeping failure must not fail a fulfilment
 *  that already succeeded. A no-op in "full" mode, where the waybill came
 *  from createShipment and was never scanned into the ledger. */
async function markConsignmentPushed(waybill: string): Promise<void> {
  try {
    await db
      .update(apcConsignmentsTable)
      .set({ pushedToShopifyAt: new Date() })
      .where(eq(apcConsignmentsTable.waybill, waybill));
  } catch (err) {
    console.warn(`[Fulfilment] could not mark consignment ${waybill} pushed:`, err instanceof Error ? err.message : err);
  }
}

async function getApcMode(): Promise<ApcMode> {
  const mode = await getAppSetting("apc_mode");
  if (mode === "off" || mode === "reconcile" || mode === "full") return mode;
  const legacy = await getAppSetting("apc_enabled");
  return legacy === "false" ? "off" : "full";
}

function pickServiceCode(
  order: ShopifyOrder,
  codes: { smallWeekday: string; largeWeekday: string; smallFriday: string; largeFriday: string },
  weightThresholdG: number,
  deliveryDate?: Date,
): string {
  const tags = order.tags.split(",").map(t => t.trim().toLowerCase());
  const weightG = order.total_weight ?? 0;

  // Use explicit box-size tags when present. Weight is a fallback only when
  // neither tag is found (e.g. no Shopify tagging rule has run yet).
  const hasLargeTag = tags.includes("large box") || tags.includes("wholesale");
  const hasSmallTag = tags.includes("small box");
  const isLargeBox = hasLargeTag || (!hasSmallTag && weightG >= weightThresholdG);

  // Service code is chosen by DISPATCH day, not delivery day. The date tag
  // we receive is the delivery date; with overnight courier the parcel
  // leaves us the day before. APC charges a premium "Friday/weekend"
  // service when the parcel sits over the weekend in transit — which
  // happens only when DISPATCH day is Friday (Sat delivery) or, in edge
  // cases, Sat/Sun (Mon delivery routes).
  //   Dispatch Mon–Thu → delivery Tue–Fri → weekday codes
  //   Dispatch Fri/Sat/Sun → weekend codes
  const delivery = deliveryDate ?? new Date();
  const dispatch = new Date(delivery);
  dispatch.setDate(dispatch.getDate() - 1);
  const dispatchDow = dispatch.getDay();
  const isWeekendDispatch = tags.includes("friday-delivery") || dispatchDow === 5 || dispatchDow === 6 || dispatchDow === 0;

  if (isLargeBox && isWeekendDispatch) return codes.largeFriday;
  if (isLargeBox) return codes.largeWeekday;
  if (isWeekendDispatch) return codes.smallFriday;
  return codes.smallWeekday;
}

/** The live consignment for an order, ignoring anything cancelled. */
async function liveConsignmentFor(orderId: number): Promise<{ waybill: string; trackingUrl: string | null } | null> {
  const rows = await db.execute<{ waybill: string; tracking_url: string | null }>(sql`
    SELECT waybill, tracking_url FROM apc_consignments
    WHERE shopify_order_id = ${orderId} AND cancelled_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `);
  const r = rows.rows[0];
  return r?.waybill ? { waybill: String(r.waybill), trackingUrl: r.tracking_url ?? null } : null;
}

/** Every waybill we already know about for an order, cancelled or not.
 *
 *  Used to stop the APC-side duplicate check resurrecting a consignment we
 *  have deliberately marked dead: APC's lookup still returns cancelled
 *  consignments (it has no status field at all), so "found at APC" only
 *  means "reuse this" when it is a consignment we have never seen — one
 *  raised by hand in Hypaship, say. Anything already in our ledger has
 *  already been judged. */
async function knownWaybillsFor(orderId: number): Promise<Set<string>> {
  const rows = await db.execute<{ waybill: string }>(sql`
    SELECT waybill FROM apc_consignments WHERE shopify_order_id = ${orderId}
  `);
  return new Set(rows.rows.map(r => String(r.waybill)));
}

/** Record a booking the moment APC accepts it. Losing this row is the one
 *  failure that could let the same order be booked twice, so a failure here
 *  is logged loudly and reported back to the caller. */
async function recordConsignment(params: {
  waybill: string;
  reference: string;
  orderId: number;
  orderName: string;
  postcode: string | null;
  trackingUrl: string | null;
  serviceCode: string;
  dispatchTag: string;
  bookedBy: string;
}): Promise<string | null> {
  try {
    await db.execute(sql`
      INSERT INTO apc_consignments
        (waybill, reference, booking_reference, shopify_order_id, shopify_order_name,
         consignee_postcode, tracking_url, service_code, dispatch_tag, booked_by)
      VALUES
        (${params.waybill}, ${params.orderName}, ${params.reference}, ${params.orderId}, ${params.orderName},
         ${params.postcode}, ${params.trackingUrl}, ${params.serviceCode}, ${params.dispatchTag}, ${params.bookedBy})
      ON CONFLICT DO NOTHING
    `);
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Fulfilment] CRITICAL: consignment ${params.waybill} booked for ${params.orderName} but NOT recorded:`, msg);
    return msg;
  }
}

async function validateOrderPostcode(
  order: ShopifyOrder,
  dispatchTag: string,
): Promise<{ available: boolean; reason?: string; serviceCode: string }> {
  if (!order.shipping_address?.zip) {
    const reason = "Order has no postcode";
    await db.execute(sql`
      INSERT INTO postcode_validations (shopify_order_id, postcode, service_code, available, reason, checked_at, dispatch_tag)
      VALUES (${order.id}, ${"MISSING"}, ${"N/A"}, ${false}, ${reason}, NOW(), ${dispatchTag})
      ON CONFLICT (shopify_order_id, service_code)
      DO UPDATE SET available = ${false}, reason = ${reason}, checked_at = NOW(), dispatch_tag = ${dispatchTag}
    `);
    return { available: false, reason, serviceCode: "N/A" };
  }

  const [smallWeekday, largeWeekday, smallFriday, largeFriday, weightThreshStr, testModeSetting] = await Promise.all([
    getAppSetting("apc_service_code_small_weekday"),
    getAppSetting("apc_service_code_large_weekday"),
    getAppSetting("apc_service_code_small_friday"),
    getAppSetting("apc_service_code_large_friday"),
    getAppSetting("apc_weight_threshold_grams"),
    getAppSetting("apc_test_mode"),
  ]);

  if (!smallWeekday || !largeWeekday || !smallFriday || !largeFriday) {
    return { available: true, serviceCode: "" };
  }

  // ALWAYS validate against APC production — the purpose of validation is
  // to check real-world postcode coverage before uploading consignments to
  // the production system. The training environment has different coverage
  // data and produced false positives (e.g. KY11 2NS passed training but
  // failed production for WL16). Test mode only gates shipment creation.
  const apiBase = undefined; // = APC production
  const dispatchDate = dispatchTag.match(/^\d{4}-\d{2}-\d{2}$/) ? new Date(dispatchTag) : new Date();
  const weightThresholdG = Number(weightThreshStr) || 1000;

  const serviceCode = pickServiceCode(
    order,
    { smallWeekday, largeWeekday, smallFriday, largeFriday },
    weightThresholdG,
    dispatchDate,
  );

  try {
    const result = await checkPostcodeService(order.shipping_address.zip, serviceCode, apiBase);

    await db.execute(sql`
      INSERT INTO postcode_validations (shopify_order_id, postcode, service_code, available, reason, checked_at, dispatch_tag)
      VALUES (${order.id}, ${order.shipping_address.zip}, ${serviceCode}, ${result.available}, ${result.reason ?? null}, NOW(), ${dispatchTag})
      ON CONFLICT (shopify_order_id, service_code)
      DO UPDATE SET available = ${result.available}, reason = ${result.reason ?? null}, checked_at = NOW(), dispatch_tag = ${dispatchTag}
    `);

    return { ...result, serviceCode };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Fulfilment] postcode check FAILED for order ${order.name} (${order.shipping_address.zip}, ${serviceCode}):`, msg);
    // SAFETY: failed checks must NOT silently pass. Previously this
    // returned available:true which hid credential/network failures
    // behind a green banner. Now surfaces the error so the user knows
    // something went wrong.
    const reason = `Check failed: ${msg}`.slice(0, 500);
    // Persisted so the queue's amber "APC check unavailable" chip survives
    // a reload — without a row the outage is invisible after the tagging
    // toast is gone. The "Check failed:" prefix is what keeps this row
    // advisory: the queue renders it amber, and the /shipments postcode
    // block explicitly skips these rows.
    try {
      await db.execute(sql`
        INSERT INTO postcode_validations (shopify_order_id, postcode, service_code, available, reason, checked_at, dispatch_tag)
        VALUES (${order.id}, ${order.shipping_address.zip}, ${serviceCode}, ${false}, ${reason}, NOW(), ${dispatchTag})
        ON CONFLICT (shopify_order_id, service_code)
        DO UPDATE SET available = ${false}, reason = ${reason}, checked_at = NOW(), dispatch_tag = ${dispatchTag}
      `);
    } catch (dbErr) {
      console.warn(`[Fulfilment] could not record check-failed row for ${order.name}:`, dbErr instanceof Error ? dbErr.message : dbErr);
    }
    return { available: false, reason, serviceCode };
  }
}

// GET /dispatch-tags — returns all active dispatch dates with unfulfilled order counts/weights.
// Used by the fulfilment landing page to show operators what needs to be done each day.
const DATE_TAG_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get("/dispatch-tags", requireFulfilmentAccess, async (_req: Request, res: Response) => {
  try {
    const orders = await getRecentUnfulfilledOrders(30);

    const groups = new Map<string, { orderCount: number; totalItems: number; totalWeightG: number }>();

    for (const order of orders) {
      const tags = order.tags.split(",").map(t => t.trim());
      const dateTag = tags.find(t => DATE_TAG_RE.test(t));
      if (!dateTag) continue;

      const existing = groups.get(dateTag) ?? { orderCount: 0, totalItems: 0, totalWeightG: 0 };
      existing.orderCount += 1;
      existing.totalItems += order.line_items.reduce((s, i) => s + i.quantity, 0);
      existing.totalWeightG += order.total_weight ?? 0;
      groups.set(dateTag, existing);
    }

    const dateTags = [...groups.keys()];
    let postcodeIssuesByTag = new Map<string, number>();
    if (dateTags.length > 0) {
      try {
        const issueRows = await db.execute<{ dispatch_tag: string; issue_count: number }>(sql`
          SELECT dispatch_tag, COUNT(*)::int as issue_count FROM (
            SELECT DISTINCT ON (shopify_order_id, dispatch_tag) shopify_order_id, dispatch_tag, available
            FROM postcode_validations
            WHERE dispatch_tag = ANY(${dateTags})
            ORDER BY shopify_order_id, dispatch_tag, checked_at DESC
          ) latest WHERE available = false
          GROUP BY dispatch_tag
        `);
        for (const r of issueRows.rows) {
          postcodeIssuesByTag.set(r.dispatch_tag, r.issue_count);
        }
      } catch {
      }
    }

    const result = [...groups.entries()]
      .map(([tag, stats]) => ({
        tag,
        ...stats,
        postcodeIssues: postcodeIssuesByTag.get(tag) ?? 0,
      }))
      .sort((a, b) => a.tag.localeCompare(b.tag));

    res.json(result);
  } catch (err: any) {
    console.error("[Fulfilment] dispatch-tags error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

router.get("/orders", requireFulfilmentAccess, async (req: Request, res: Response) => {
  const { tag, includeAll } = req.query as { tag?: string; includeAll?: string };

  if (!tag) {
    res.status(400).json({ error: "tag query param required" });
    return;
  }

  try {
    const orders = includeAll === "1"
      ? await getOrdersByTag(tag)
      : await getUnfulfilledOrdersByTag(tag);

    const [allLocations, allBarcodes, recipeMappings] = await Promise.all([
      db.select().from(skuLocationsTable),
      db.select().from(skuBarcodesTable),
      // recipe_shopify_mappings has no Drizzle schema — raw SQL. Pull
      // every mapping row joined to its recipe colour, then build lookup
      // maps by both variant id and SKU so a line item can be coloured
      // even when only one of those two is set.
      db.execute<{ shopify_variant_id: string | null; shopify_sku: string | null; color: string | null }>(sql`
        SELECT m.shopify_variant_id, m.shopify_sku, r.color
        FROM recipe_shopify_mappings m
        JOIN recipes r ON r.id = m.recipe_id
        WHERE r.color IS NOT NULL
      `),
    ]);
    const locationBySku = new Map(allLocations.map(l => [l.sku, l]));
    // Barcode/image are matched by variant id ONLY. SKUs here are shelf
    // labels shared by many products ("1" covers buttermilk AND korean
    // strips), so a SKU-keyed lookup can attach the wrong product's barcode
    // to a line item — a mis-scan the packer has no way to catch. A missing
    // variant row means no barcode (manual SKU/title entry still works)
    // rather than a wrong one.
    const barcodeRowByVariantId = new Map(allBarcodes.map(b => [b.variantId, b]));
    const colorByVariantId = new Map<string, string>();
    const colorBySku = new Map<string, string>();
    for (const row of recipeMappings.rows as Array<{ shopify_variant_id: string | null; shopify_sku: string | null; color: string | null }>) {
      if (!row.color) continue;
      if (row.shopify_variant_id) colorByVariantId.set(row.shopify_variant_id, row.color);
      if (row.shopify_sku) colorBySku.set(row.shopify_sku, row.color);
    }

    const enriched = orders.map(order => {
      const lineItems = order.line_items.map(item => {
        const variantKey = item.variant_id != null ? String(item.variant_id) : null;
        const recipeColor =
          (variantKey && colorByVariantId.get(variantKey)) ??
          (item.sku && colorBySku.get(item.sku)) ??
          null;
        const barcodeRow = variantKey ? (barcodeRowByVariantId.get(variantKey) ?? null) : null;
        return {
          ...item,
          location: item.sku ? (locationBySku.get(item.sku) ?? null) : null,
          barcode: barcodeRow?.barcode ?? null,
          imageUrl: barcodeRow?.imageUrl ?? null,
          recipeColor,
        };
      });
      return { ...order, line_items: lineItems };
    });

    res.json(enriched);
  } catch (err: any) {
    console.error("[Fulfilment] orders error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /scan-queue — returns dispatch-tagged unfulfilled orders for a date,
// optionally filtered by box category, along with a variantId→barcode map
// covering every line-item variant in the queue. The packing-cycle scan
// view uses this to verify scans against the order without needing a local
// barcode mapping table — Shopify variant.barcode is the source of truth.
router.get("/scan-queue", requireFulfilmentAccess, async (req: Request, res: Response) => {
  const { tag, category } = req.query as { tag?: string; category?: string };
  if (!tag) {
    res.status(400).json({ error: "tag query param required" });
    return;
  }

  try {
    const all = await getUnfulfilledOrdersByTag(tag);

    // Only orders explicitly tagged for dispatch enter the packing queue.
    let queue = all.filter(o =>
      o.tags.split(",").map(t => t.trim()).includes("dispatch")
    );

    if (category && category !== "all") {
      const wanted = category.toLowerCase();
      queue = queue.filter(o => {
        const tags = o.tags.split(",").map(t => t.trim().toLowerCase());
        if (wanted === "small box") return tags.includes("small box");
        if (wanted === "large box") return tags.includes("large box");
        if (wanted === "wholesale") return tags.includes("wholesale");
        if (wanted === "other") {
          return !tags.includes("small box") && !tags.includes("large box") && !tags.includes("wholesale");
        }
        return true;
      });
    }

    queue.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const variantIds = Array.from(new Set(
      queue.flatMap(o => o.line_items.map(li => li.variant_id).filter((v): v is number => v != null))
    )).map(String);

    const barcodeMap = await getVariantBarcodes(variantIds);
    const barcodes: Record<string, string> = {};
    for (const [vid, bc] of barcodeMap) barcodes[vid] = bc;

    res.json({ tag, orders: queue, barcodes });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Fulfilment] scan-queue error:", msg);
    res.status(502).json({ error: msg });
  }
});

// POST /orders/:id/scan-complete — completes a packed order from the
// scan-cycle view. Decrements production_fridge stock and fulfils on
// Shopify. Unlike /orders/:id/complete this does NOT require an APC
// consignment number: the scanner is a verification-only layer and
// assumes the APC label (if any) was already produced via the existing
// per-order shipment flow before scanning began. When a consignmentNumber
// is supplied (e.g. from a label printed earlier in the same cycle) it
// flows through to Shopify so the customer still gets tracking info.
const ScanCompleteBody = z.object({
  consignmentNumber: z.string().optional(),
  trackingUrl: z.string().optional(),
});

router.post("/orders/:id/scan-complete", requireFulfilmentAccess, async (req: Request, res: Response) => {
  const orderId = Number(req.params.id);
  if (isNaN(orderId)) {
    res.status(400).json({ error: "Invalid order ID" });
    return;
  }

  const parsed = ScanCompleteBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { consignmentNumber, trackingUrl } = parsed.data;

  try {
    const [existing] = await db
      .select({ shopifyOrderId: shopifyFulfilmentTrackingTable.shopifyOrderId })
      .from(shopifyFulfilmentTrackingTable)
      .where(eq(shopifyFulfilmentTrackingTable.shopifyOrderId, orderId));
    if (!existing) {
      const order = await getOrderById(orderId);
      if (order?.line_items && order.line_items.length > 0) {
        try {
          const result = await decrementFridgeForShopifyOrder(orderId, order.line_items);
          if (result.unmapped.length > 0) {
            console.warn(`[scan-complete] order ${orderId} — unmapped variant ids:`, result.unmapped.join(", "));
          }
          await db.insert(shopifyFulfilmentTrackingTable).values({
            shopifyOrderId: orderId,
            fulfilledAt: new Date(),
            source: "immediate",
          }).onConflictDoNothing();
          try {
            await addTagToOrder(orderId, order.tags ?? "", FACTORY_NUMBER_TAG);
          } catch (tagErr) {
            console.warn(`[scan-complete] FACTORY_NUMBER_TAG write failed for order ${orderId}:`, tagErr instanceof Error ? tagErr.message : tagErr);
          }
        } catch (decErr) {
          // Non-fatal: a stock-decrement bug must never block fulfilment.
          console.error(`[scan-complete] inventory decrement failed for order ${orderId}:`, decErr);
        }
      }
    }
  } catch (err) {
    console.error(`[scan-complete] tracking-table lookup failed for order ${orderId}:`, err);
  }

  try {
    await fulfillOrder(
      orderId,
      consignmentNumber ?? "",
      consignmentNumber ? "APC Overnight" : "",
      trackingUrl,
    );
    if (consignmentNumber) await markConsignmentPushed(consignmentNumber);
    res.json({ ok: true, orderId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[scan-complete] fulfillOrder error:", msg);
    res.status(502).json({ error: msg });
  }
});

const CreateShipmentBody = z.object({
  orderId: z.number(),
  tag: z.string(),
  dispatchDate: z.string().optional(), // ISO date string e.g. "2025-01-17"
});

router.post("/shipments", requireFulfilmentAccess, async (req: Request, res: Response) => {
  const parsed = CreateShipmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "orderId (number) and tag (string) are required" });
    return;
  }

  if (!isApcConfigured()) {
    res.status(503).json({ error: "APC credentials not configured. Please set APC_USERNAME, APC_PASSWORD and APC_ACCOUNT_NUMBER." });
    return;
  }

  const { orderId, tag, dispatchDate: dispatchDateStr } = parsed.data;
  const dispatchDate = dispatchDateStr ? new Date(dispatchDateStr) : new Date();

  try {
    const [smallWeekday, largeWeekday, smallFriday, largeFriday, weightThreshStr, testModeSetting] = await Promise.all([
      getAppSetting("apc_service_code_small_weekday"),
      getAppSetting("apc_service_code_large_weekday"),
      getAppSetting("apc_service_code_small_friday"),
      getAppSetting("apc_service_code_large_friday"),
      getAppSetting("apc_weight_threshold_grams"),
      getAppSetting("apc_test_mode"),
    ]);

    const isTestMode = testModeSetting === "true";
    const apiBase = isTestMode ? APC_TRAINING_BASE : undefined;

    if (!smallWeekday || !largeWeekday || !smallFriday || !largeFriday) {
      res.status(400).json({
        error: "APC service codes not configured. Please set all 4 service codes in App Settings.",
        missingCodes: {
          smallWeekday: !smallWeekday,
          largeWeekday: !largeWeekday,
          smallFriday: !smallFriday,
          largeFriday: !largeFriday,
        },
      });
      return;
    }

    const weightThresholdG = Number(weightThreshStr) || 1000;
    const orders = await getOrdersByTag(tag);
    const order = orders.find(o => o.id === orderId);

    if (!order) {
      res.status(404).json({ error: `Order #${orderId} not found in tag "${tag}"` });
      return;
    }

    if (!order.shipping_address) {
      res.status(422).json({ error: "Order has no shipping address — cannot create shipment." });
      return;
    }

    const serviceCode = pickServiceCode(
      order,
      { smallWeekday, largeWeekday, smallFriday, largeFriday },
      weightThresholdG,
      dispatchDate,
    );

    // Batch-book-only guard (Graeme, 2026-08-13): consignments are raised in
    // a checked batch at the start of the day, NOT one-by-one as orders are
    // opened — a bad batch of five is reviewed before labels fly, instead of
    // wrong consignments being created all day and cancelled after. When the
    // switch is off, this endpoint only ever RETURNS an existing label
    // (reuse path below); an unbooked order is a 409 telling the packer to
    // batch-book it, never a fresh booking.
    const bookOnOpen = (await getAppSetting("apc_book_on_open")) !== "false";

    // ── Never book the same order twice ──────────────────────────────────
    // Backing out and re-opening an order, a page refresh mid-pick, or two
    // packers on the same order would each fire this endpoint again, and
    // every call is a real consignment APC will invoice. Check two places
    // before booking: our own ledger (instant), then APC itself by
    // reference (authoritative — catches a consignment raised by hand in
    // Hypaship, or by another device). Either hit returns the EXISTING
    // label rather than raising a second one.
    const postcode = order.shipping_address.zip;
    let reusedWaybill: string | null = null;
    let reusedTrackingUrl: string | null = null;
    let lookupFailure: string | null = null;

    const prior = await liveConsignmentFor(orderId);
    if (prior) {
      reusedWaybill = prior.waybill;
      reusedTrackingUrl = prior.trackingUrl;
      console.log(`[Fulfilment] ${order.name} already has consignment ${reusedWaybill} — reusing, not re-booking`);
    } else {
      try {
        // Only a consignment we have NEVER seen counts as a reason not to
        // book — one we recorded and then marked cancelled must not be
        // resurrected here, and APC cannot tell us it is cancelled.
        const known = await knownWaybillsFor(orderId);
        const live = (await lookupOrdersByReference(order.name, apiBase))
          .find(c => c.waybill && !known.has(c.waybill));
        if (live?.waybill) {
          reusedWaybill = live.waybill;
          console.log(`[Fulfilment] APC already holds ${live.waybill} for ${order.name} — reusing`);
          await db.execute(sql`
            INSERT INTO apc_consignments (waybill, reference, booking_reference, shopify_order_id, shopify_order_name, consignee_postcode, dispatch_tag)
            VALUES (${live.waybill}, ${order.name}, ${order.name}, ${orderId}, ${order.name}, ${postcode}, ${tag})
            ON CONFLICT DO NOTHING
          `);
        }
      } catch (lookupErr) {
        // A lookup outage must not stop packing — but say so loudly, because
        // the duplicate check was weaker for this order.
        lookupFailure = lookupErr instanceof Error ? lookupErr.message : String(lookupErr);
        console.warn(`[Fulfilment] duplicate-check lookup failed for ${order.name}:`, lookupFailure);
      }
    }

    if (reusedWaybill) {
      const labels = await fetchLabel(reusedWaybill, apiBase);
      res.json({
        consignmentNumber: reusedWaybill,
        labelPdfBase64: labels[0],
        // How many labels this consignment actually has. The client prints via
        // the live label route, one request per piece — without this it would
        // print piece 1 and quietly leave the rest of a multi-box consignment
        // unlabelled, which is what taking labels[0] here used to do.
        pieceCount: labels.length,
        trackingUrl: reusedTrackingUrl ?? apcTrackingUrl(reusedWaybill, postcode),
        serviceCode,
        orderId,
        orderName: order.name,
        reused: true,
      });
      return;
    }

    if (!bookOnOpen) {
      if (lookupFailure) {
        // Without a working APC lookup we cannot tell "not uploaded yet"
        // from "uploaded but unreachable" — and in batch-only mode the
        // lookup is the ONLY way to a label. Telling the packer to
        // batch-book would be wrong on both counts.
        res.status(502).json({
          error: `Could not check APC for ${order.name}'s consignment: ${lookupFailure}`,
        });
        return;
      }
      res.status(409).json({
        error: `${order.name} has no consignment yet — checked our ledger and APC by reference "${order.name}". Batch-book it from the queue, or upload it in Hypaship (reference must be exactly ${order.name}), then retry.`,
        needsBooking: true,
      });
      return;
    }

    // Postcode block — checked only on the FRESH-booking path, after the
    // reuse checks above. A consignment that already exists (batch-booked,
    // or hand-uploaded to Hypaship) has already passed APC's own validation
    // at upload time, so a stored rejection must never stop its label being
    // fetched and printed (2026-08-20: bogus rows from a validator auth
    // outage blocked every order before the reuse path could run).
    // "Check failed:" rows are the validator reporting its OWN outage —
    // advisory (amber chip), never a postcode verdict, so they don't block
    // booking either: a genuinely bad postcode still fails loudly at
    // createShipment, which books against APC production.
    const existingValidation = await db.execute<{ available: boolean; reason: string | null; service_code: string }>(sql`
      SELECT available, reason, service_code FROM postcode_validations
      WHERE shopify_order_id = ${orderId} AND dispatch_tag = ${tag} AND service_code = ${serviceCode} AND available = false
        AND (reason IS NULL OR reason NOT LIKE 'Check failed:%')
      ORDER BY checked_at DESC LIMIT 1
    `);
    if (existingValidation.rows.length > 0) {
      const v = existingValidation.rows[0];
      res.status(422).json({
        error: `Postcode issue: ${v.reason || "Service not available for this postcode"} (Service: ${v.service_code}). Re-check the postcode before packing.`,
        postcodeBlocked: true,
      });
      return;
    }

    const weightKg = (order.total_weight ?? 500) / 1000;
    const customerName = order.shipping_address.name ||
      `${order.customer?.first_name ?? ""} ${order.customer?.last_name ?? ""}`.trim();

    const companyName = order.shipping_address.company?.trim() || "Home Delivery";

    let specialInstructions = "X227 - PERISHABLE";
    if (order.note?.trim()) {
      const combined = `${specialInstructions} ${order.note.trim()}`;
      specialInstructions = combined.slice(0, 50);
    }

    // APC's booking platform only searches references by exact match, so
    // the reference must stay exactly the Shopify order number — a suffix
    // would make the consignment unfindable by the number staff search for.
    const bookingReference = order.name;

    const result = await createShipment({
      serviceCode,
      companyName,
      recipient: {
        name: customerName,
        address1: order.shipping_address.address1,
        address2: order.shipping_address.address2,
        city: order.shipping_address.city,
        postcode: order.shipping_address.zip,
        country: order.shipping_address.country_code ?? "GB",
        phone: order.shipping_address.phone ?? order.customer?.phone,
        email: order.customer?.email,
      },
      parcels: [{ weight: Math.max(0.1, weightKg) }],
      reference: bookingReference,
      specialInstructions,
      ...(apiBase ? { apiBase } : {}),
    });

    // Record it immediately — this row is what stops a second booking if the
    // packer backs out and re-opens the order, or the page is refreshed.
    const recordError = await recordConsignment({
      waybill: result.consignmentNumber,
      reference: bookingReference,
      orderId,
      orderName: order.name,
      postcode,
      trackingUrl: result.trackingUrl ?? null,
      serviceCode,
      dispatchTag: tag,
      bookedBy: await resolveUserName(req),
    });

    res.json({
      ...(recordError ? { recordError } : {}),
      consignmentNumber: result.consignmentNumber,
      labelPdfBase64: result.labelPdfBase64,
      // A freshly booked consignment is always single-parcel here — extra
      // boxes are added afterwards via add-parcel, which returns its own count.
      pieceCount: 1,
      trackingUrl: result.trackingUrl,
      serviceCode,
      orderId,
      orderName: order.name,
      ...(result.warnings?.length ? { warnings: result.warnings } : {}),
    });
  } catch (err: any) {
    console.error("[Fulfilment] createShipment error:", err.message);
    const status = err.message?.includes("not configured") ? 503 :
      err.message?.includes("not found") ? 404 : 502;
    res.status(status).json({ error: err.message });
  }
});

// ── Reconcile mode: look up the hand-raised consignment for an order ───────
// Called when the packer opens an order (and prefetched for the queue), so the
// waybill is in hand before anyone touches a box and an APC outage surfaces
// before packing rather than halfway through.
//
// Returns 404 when APC has no consignment for the reference — the signal that
// the reference was mistyped during the manual upload. The packer must not be
// allowed to ship that order until it's fixed.
router.get("/consignment-for-order", requireFulfilmentAccess, async (req: Request, res: Response) => {
  const orderName = typeof req.query.orderName === "string" ? req.query.orderName.trim() : "";
  if (!orderName) {
    res.status(400).json({ error: "orderName query param required, e.g. ?orderName=%23131377" });
    return;
  }
  if (!isApcConfigured()) {
    res.status(503).json({ error: "APC credentials not configured." });
    return;
  }

  try {
    // Deliberately LIVE regardless of apc_test_mode: in reconcile mode the
    // consignment was raised by hand in the live Hypaship account, so looking
    // it up on the training server just returns a 419 that reads like bad
    // credentials. Nothing is booked here — it's a read — so there's no
    // side-effect risk in ignoring test mode.
    const matches = await lookupOrdersByReference(orderName);
    const lookup = matches[0];
    if (!lookup || !lookup.waybill) {
      res.status(404).json({
        error: `APC has no consignment with reference "${orderName}". Check the reference in Hypaship before packing this order.`,
        notFound: true,
      });
      return;
    }

    res.json({
      waybill: lookup.waybill,
      // The 14 digits a scanned label barcode must contain to belong to this
      // consignment. Sent so the UI can explain a mismatch, NOT so the client
      // can decide the verdict — that stays server-side in /verify-label-scan.
      expectedCore: waybillCore(lookup.waybill),
      reference: lookup.reference,
      consigneeName: lookup.consigneeName,
      consigneeCompany: lookup.consigneeCompany,
      consigneePostcode: lookup.consigneePostcode,
      productCode: lookup.productCode,
      trackingUrl: apcTrackingUrl(lookup.waybill, lookup.consigneePostcode),
      // A skipped-then-re-tagged order gets uploaded to Hypaship twice, so one
      // reference can hold several live consignments (and several printed
      // labels). The scan accepts whichever label matches; this count lets the
      // UI warn the packer that spare labels for this order exist and must be
      // binned.
      duplicateCount: matches.length,
      duplicateWaybills: matches.map(m => m.waybill),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Fulfilment] consignment-for-order error:", msg);
    res.status(502).json({ error: msg });
  }
});

// ── Reconcile mode: fetch the label PDF for a HAND-RAISED consignment ──────
// Graeme's control test (2026-08-20): consignments stay manually uploaded
// via the Excel flow, but the label can be (re)printed per order from the
// bench — proving the print pipeline in isolation before the app ever
// books consignments itself. Pure read against live APC: looks up the
// consignment by the order reference, pulls its label PDF(s). Books
// nothing.
router.get("/reconcile-label", requireFulfilmentAccess, async (req: Request, res: Response) => {
  const orderName = typeof req.query.orderName === "string" ? req.query.orderName.trim() : "";
  if (!orderName) {
    res.status(400).json({ error: "orderName query param required" });
    return;
  }
  if (!isApcConfigured()) {
    res.status(503).json({ error: "APC credentials not configured." });
    return;
  }
  try {
    const matches = await lookupOrdersByReference(orderName);
    const lookup = matches[0];
    if (!lookup?.waybill) {
      res.status(404).json({
        error: `APC has no consignment with reference "${orderName}". Check the reference in Hypaship.`,
        notFound: true,
      });
      return;
    }
    const labelPdfs = await fetchLabel(lookup.waybill);
    res.json({
      waybill: lookup.waybill,
      labelPdfs,
      duplicateCount: matches.length,
      duplicateWaybills: matches.map(m => m.waybill),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Fulfilment] reconcile-label error:", msg);
    res.status(502).json({ error: msg });
  }
});

// ── Reconcile mode: verify a scanned label against the order being packed ──
// The verdict is decided HERE, not in the browser, and the ledger insert is
// what enforces one-label-one-order. Three distinct outcomes, because they
// need three different actions on the bench:
//   too-short      → they scanned the depot/route barcode; aim at the long one
//   wrong-order    → this label belongs to another consignment; do not ship it
//   already-used   → this waybill is already on a different order
const VerifyLabelBody = z.object({
  orderId: z.number(),
  orderName: z.string().min(1),
  barcode: z.string().min(1),
});

router.post("/verify-label-scan", requireFulfilmentAccess, async (req: Request, res: Response) => {
  const parsed = VerifyLabelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "orderId, orderName and barcode are required" });
    return;
  }
  const { orderId, orderName, barcode } = parsed.data;

  const scan = parseApcBarcode(barcode);
  if (!scan.ok) {
    res.json({
      verified: false,
      problem: scan.reason,
      message: scan.reason === "too-short"
        ? "That's the short depot barcode — scan the long barcode on the label."
        : "Not a recognisable APC parcel barcode.",
    });
    return;
  }

  if (!isApcConfigured()) {
    res.status(503).json({ error: "APC credentials not configured." });
    return;
  }

  try {
    // Live regardless of apc_test_mode — see the note in /consignment-for-order.
    const matches = await lookupOrdersByReference(orderName);
    if (!matches.length || !matches[0].waybill) {
      res.json({
        verified: false,
        problem: "no-consignment",
        message: `APC has no consignment with reference "${orderName}". Check Hypaship before shipping this order.`,
      });
      return;
    }

    // A skipped-then-re-tagged order holds several consignments under one
    // reference, each with its own printed label. Any of them proves the label
    // belongs to THIS order, so match the scan against all of them — the
    // matched consignment is the one recorded and pushed to Shopify.
    const lookup = matches.find(m => waybillCore(m.waybill ?? "") === scan.core);
    if (!lookup || !lookup.waybill) {
      res.json({
        verified: false,
        problem: "wrong-order",
        message: "This label belongs to a DIFFERENT consignment — do not ship it on this order.",
        scannedCore: scan.core,
        expectedCore: waybillCore(matches[0].waybill ?? ""),
        expectedCores: matches.map(m => waybillCore(m.waybill ?? "")),
      });
      return;
    }

    const trackingUrl = apcTrackingUrl(lookup.waybill, lookup.consigneePostcode);
    const userId = req.session?.userId ?? null;
    let userName: string | null = null;
    if (userId) {
      const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
      userName = u?.name ?? null;
    }

    // The UNIQUE waybill turns "same label scanned twice" into a conflict we
    // can reason about instead of a silent duplicate.
    const [inserted] = await db.insert(apcConsignmentsTable).values({
      waybill: lookup.waybill,
      reference: lookup.reference,
      shopifyOrderId: orderId,
      shopifyOrderName: orderName,
      consigneeName: lookup.consigneeName,
      consigneePostcode: lookup.consigneePostcode,
      scannedBarcode: barcode,
      trackingUrl,
      verifiedByUserId: userId,
      verifiedByName: userName,
    }).onConflictDoNothing({ target: apcConsignmentsTable.waybill }).returning();

    if (!inserted) {
      // Already claimed. Re-scanning the SAME order is harmless (a packer
      // going back a step); a different order is a genuine mix-up.
      const [existing] = await db
        .select()
        .from(apcConsignmentsTable)
        .where(eq(apcConsignmentsTable.waybill, lookup.waybill));

      if (existing && existing.shopifyOrderId !== orderId) {
        res.json({
          verified: false,
          problem: "already-used",
          message: `That label is already scanned onto order ${existing.shopifyOrderName ?? existing.shopifyOrderId}. Do not ship it twice.`,
        });
        return;
      }
    }

    res.json({
      verified: true,
      consignmentNumber: lookup.waybill,
      trackingUrl,
      reference: lookup.reference,
      consigneeName: lookup.consigneeName,
      consigneePostcode: lookup.consigneePostcode,
      parcel: scan.itemNumber,
      duplicateCount: matches.length,
      message: matches.length > 1
        ? `Label verified. NOTE: APC holds ${matches.length} consignments for this order (it was uploaded more than once) — bin any spare labels for it.`
        : "Label verified.",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Fulfilment] verify-label-scan error:", msg);
    res.status(502).json({ error: msg });
  }
});

// ── APC label-scan probe (read-only diagnostic) ────────────────────────────
// Proves the pieces the "scan the printed APC label" flow depends on, without
// changing anything:
//   1. can we find a manually-uploaded consignment by OUR reference?
//   2. does the barcode on its printed label match the waybill APC returns?
//
// GET /api/fulfilment/apc-probe?reference=131377&barcode=03036990014368001
//
// Strictly a GET against APC's Orders endpoint with labels=False and
// markprinted=False, so it cannot mark a label printed, book anything, or
// cancel anything. Admin-only.
//
// Defaults to whatever apc_test_mode says, but takes ?env=live|training to
// override. The override exists because consignments uploaded by hand into
// Hypaship only exist on the LIVE server — pointing a lookup for one at the
// training server returns a 419 auth error, which reads like bad credentials
// when it's really the wrong environment.
router.get("/apc-probe", requireAdmin, async (req: Request, res: Response) => {
  const reference = typeof req.query.reference === "string" ? req.query.reference : "";
  const barcode = typeof req.query.barcode === "string" ? req.query.barcode : "";
  const envParam = typeof req.query.env === "string" ? req.query.env : "";

  if (envParam && envParam !== "live" && envParam !== "training") {
    res.status(400).json({ error: "env must be 'live' or 'training' when supplied" });
    return;
  }

  if (!reference && !barcode) {
    res.status(400).json({ error: "reference and/or barcode query param required, e.g. ?reference=131377&barcode=03036990014368001" });
    return;
  }
  if (!isApcConfigured()) {
    res.status(503).json({ error: "APC credentials not configured in this environment (APC_USERNAME / APC_PASSWORD / APC_ACCOUNT_NUMBER)." });
    return;
  }

  const scan = barcode ? parseApcBarcode(barcode) : null;

  try {
    const apiBase = envParam === "live" ? undefined
      : envParam === "training" ? APC_TRAINING_BASE
      : await getTestModeApiBase();

    // matchedReferenceForm is only present when the reference lookup hit — the
    // waybill fallback identifies the parcel without one.
    let lookup: (ApcOrderLookup & { matchedReferenceForm?: string }) | null =
      reference ? await lookupOrderByReference(reference, apiBase) : null;
    let foundVia: "reference" | "waybill" | null = lookup ? "reference" : null;

    // Fall back to identifying the parcel by its own barcode. The 22-digit
    // waybill is <8-digit send date><14-digit core> and the barcode carries
    // only the core, so try a few plausible send dates around today. This is
    // how we discover what reference APC actually holds when a lookup by our
    // reference finds nothing.
    const triedWaybills: string[] = [];
    if (!lookup && scan?.ok) {
      const today = new Date();
      for (let offset = 1; offset >= -6 && !lookup; offset--) {
        const d = new Date(today);
        d.setDate(d.getDate() + offset);
        const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
        const candidate = `${stamp}${scan.core}`;
        triedWaybills.push(candidate);
        try {
          const hit = await lookupOrderByWaybill(candidate, apiBase);
          if (hit) { lookup = hit; foundVia = "waybill"; }
        } catch {
          // A miss on one date is expected — keep trying the others.
        }
      }
    }

    if (!lookup) {
      res.json({
        queriedReference: reference || null,
        found: false,
        triedWaybills,
        message: "APC has no consignment for that reference, and the scanned barcode didn't resolve to one either. On the real flow this is the signal that the reference was mistyped during the manual upload — packing would be blocked for this order.",
        scan,
        environment: apiBase != null ? "training" : "live",
      });
      return;
    }

    const expectedCore = waybillCore(lookup.waybill ?? "");
    const verdict = !scan
      ? null
      : !scan.ok
        ? {
            match: false,
            problem: scan.reason,
            message: scan.reason === "too-short"
              ? "That's the short depot/route barcode on the label — scan the long one instead."
              : "Not a recognisable APC parcel barcode.",
          }
        : {
            match: scan.core === expectedCore,
            scannedCore: scan.core,
            expectedCore,
            barcodeFormat: scan.format,
            parcel: scan.itemNumber,
            message: scan.core === expectedCore
              ? "Label matches this order's consignment."
              : "This label belongs to a DIFFERENT consignment — do not ship it on this order.",
          };

    res.json({
      queriedReference: reference || null,
      found: true,
      foundVia,
      matchedReferenceForm: lookup.matchedReferenceForm ?? null,
      // When we only found it by waybill, this is the value the manual upload
      // actually wrote — compare it against the Shopify order number.
      referenceHeldByApc: lookup.reference,
      // What would be written to Shopify for this order.
      wouldSendToShopify: {
        trackingNumber: lookup.waybill,
        trackingCompany: "APC Overnight",
        trackingUrl: apcTrackingUrl(lookup.waybill ?? "", lookup.consigneePostcode),
      },
      scan,
      verdict,
      environment: apiBase != null ? "training" : "live",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Fulfilment] apc-probe error:", msg);
    res.status(502).json({ error: msg, scan });
  }
});

async function getTestModeApiBase(): Promise<string | undefined> {
  const testModeSetting = await getAppSetting("apc_test_mode");
  return testModeSetting === "true" ? APC_TRAINING_BASE : undefined;
}

router.post("/shipments/:waybill/add-parcel", requireFulfilmentAccess, async (req: Request<{ waybill: string }>, res: Response) => {
  const { waybill } = req.params;
  const { weight, length, width, height } = (req.body ?? {}) as {
    weight?: number; length?: number; width?: number; height?: number;
  };

  if (!isApcConfigured()) {
    res.status(503).json({ error: "APC credentials not configured." });
    return;
  }

  try {
    const apiBase = await getTestModeApiBase();

    const result = await addParcel({
      waybill,
      parcel: {
        weight: typeof weight === "number" && weight > 0 ? weight : 1.0,
        ...(length ? { length } : {}),
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
      },
      ...(apiBase ? { apiBase } : {}),
    });

    res.json({
      waybill,
      labelPdfs: result.labelPdfs,
      pieceCount: result.labelPdfs.length,
      ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Fulfilment] add-parcel error for ${waybill}:`, msg);
    res.status(502).json({ error: msg });
  }
});

router.post("/shipments/:waybill/reprint-label", requireFulfilmentAccess, async (req: Request<{ waybill: string }>, res: Response) => {
  const { waybill } = req.params;

  if (!isApcConfigured()) {
    res.status(503).json({ error: "APC credentials not configured." });
    return;
  }

  try {
    const apiBase = await getTestModeApiBase();
    const base = apiBase ?? (process.env.APC_API_BASE ?? "https://apc.hypaship.com/api/3.0");

    const labelPdfs = await fetchLabel(waybill, base);

    // Only the COUNT goes back. The client prints each piece through the live
    // label route, so shipping ~180KB of base64 per label here would be paid
    // for and thrown away. This call still hits APC, which is deliberate: it
    // re-reads the consignment as it stands NOW, so a reprint that follows an
    // amendment (extra parcel, service upgrade) prints the right number of
    // labels rather than the count from when the order was opened.
    res.json({ waybill, pieceCount: labelPdfs.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Fulfilment] reprint-label error for ${waybill}:`, msg);
    res.status(502).json({ error: msg });
  }
});

// ── Live label pass-through ────────────────────────────────────────────────
// Streams a consignment's label PDF straight from APC on every request.
//
// NOTHING IS STORED. That is the point, and it is a deliberate design decision
// (Graeme, 2026-08-20): a consignment gets amended at the bench — an extra
// parcel, a service upgrade when the products won't fit the box — and the
// reprint that follows must show the CURRENT state of the consignment. A
// cached PDF is a wrong label on a real box, so there is no cache, no bytea
// column, and no-store on the way out.
//
// It exists because the print path needs a SAME-ORIGIN url. The page builds a
// `blob:` URL and points a hidden iframe at it, and the app's own CSP
// (frame-src 'self' + youtube/vimeo, see app.ts) does not allow blob: — Chrome
// blocks the frame, print() then throws SecurityError on the opaque document,
// and the bench sees a bare "Print failed" for a label that is perfectly fine
// at APC. Serving the same bytes from this route satisfies frame-src 'self'
// with no CSP change at all.
//
// Doubles as the no-printer test: open the URL in a tab and the label renders.
//
// GET /api/fulfilment/shipments/:waybill/label.pdf?piece=1
router.get("/shipments/:waybill/label.pdf", requireFulfilmentAccess, async (req: Request, res: Response) => {
  // req.params is typed string | string[] under this router's generics.
  const waybill = String(req.params.waybill ?? "");
  const pieceParam = typeof req.query.piece === "string" ? parseInt(req.query.piece, 10) : 1;
  const piece = Number.isFinite(pieceParam) && pieceParam > 0 ? pieceParam : 1;

  if (!isApcConfigured()) {
    res.status(503).json({ error: "APC credentials not configured." });
    return;
  }

  try {
    const apiBase = await getTestModeApiBase();

    // Tighter than the default 4×3s. A label that genuinely is not there must
    // fail fast enough for the packer to act on it — 12s of silent retrying
    // reads as a hang at the bench. 3 attempts ≈ 2.5s worst case still covers
    // the brief lag after a consignment is amended in Hypaship.
    const labels = await fetchLabel(waybill, apiBase, 2, 750, /* markPrinted */ false);

    if (piece > labels.length) {
      res.status(404).json({
        error: `Consignment ${waybill} has ${labels.length} label(s); piece ${piece} does not exist.`,
      });
      return;
    }

    const pdf = Buffer.from(labels[piece - 1], "base64");

    // A label is only ever correct at the instant it is fetched. Any cache —
    // browser, proxy, CDN — could hand back a pre-amendment label, which is
    // the exact failure this route is designed to make impossible.
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(pdf.length));
    res.setHeader("Content-Disposition", `inline; filename="${waybill}-${piece}.pdf"`);
    res.send(pdf);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Fulfilment] label.pdf error for ${waybill} piece ${piece}:`, msg);
    res.status(502).json({ error: msg });
  }
});

// Cancel is called BEFORE "Confirm & Complete" — the order has not been fulfilled
// on Shopify yet, so there is no Shopify fulfillment to undo. The only server-side
// state to reset is the APC consignment itself. The frontend removes the local
// shipment reference and returns the operator to the order list, where the order
// remains in the unfulfilled queue ready to be re-packed.
router.post("/shipments/:waybill/cancel", requireFulfilmentAccess, async (req: Request<{ waybill: string }>, res: Response) => {
  const { waybill } = req.params;

  if (!isApcConfigured()) {
    res.status(503).json({ error: "APC credentials not configured." });
    return;
  }

  try {
    const apiBase = await getTestModeApiBase();

    await cancelShipment(waybill, apiBase);

    // Stamp our ledger too. Without this the duplicate guard would keep
    // handing back this dead waybill and the order could never be re-raised.
    await db.execute(sql`UPDATE apc_consignments SET cancelled_at = NOW() WHERE waybill = ${waybill}`);

    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Fulfilment] cancel error for ${waybill}:`, msg);
    res.status(502).json({ error: msg });
  }
});

// POST /tag-dispatch — find an order by name and add the "dispatch" tag.
// Used by the Dispatch Tagging page to gate which orders appear in the packing queue.
router.post("/tag-dispatch", requireFulfilmentAccess, async (req: Request, res: Response) => {
  const { orderName } = req.body as { orderName?: string };
  if (!orderName || typeof orderName !== "string" || !orderName.trim()) {
    res.status(400).json({ error: "orderName is required" });
    return;
  }
  try {
    const order = await findOrderByName(orderName.trim());
    if (!order) {
      res.status(404).json({ error: `Order ${orderName.trim()} not found` });
      return;
    }
    const alreadyTagged = order.tags.split(",").map(t => t.trim()).includes("dispatch");
    if (!alreadyTagged) {
      await addTagToOrder(order.id, order.tags, "dispatch");
    }

    let postcodeCheck: { available: boolean; reason?: string; serviceCode: string } | undefined;
    const tags = order.tags.split(",").map(t => t.trim());
    const dateTag = tags.find(t => DATE_TAG_RE.test(t));
    // Postcode coverage only matters when the app is creating APC
    // consignments. With apc_enabled=false the operator books couriers
    // manually, so don't call APC at all (and don't record blocking rows).
    // Auto-validate postcodes only in "full" mode, where the app itself books
    // the consignment and a bad postcode would fail at label time. In
    // "reconcile" mode consignments are uploaded to APC by hand — APC flags
    // service problems there, so a stored failure here must never gate the
    // scanner (2026-07-29: stale LW16 rejections blocked the whole pick list).
    const apcEnabledForTagging = (await getApcMode()) === "full";
    if (apcEnabledForTagging && isApcConfigured() && dateTag) {
      postcodeCheck = await validateOrderPostcode(order, dateTag);
    }

    res.json({
      ok: true,
      alreadyTagged,
      postcodeCheck: postcodeCheck ? { available: postcodeCheck.available, reason: postcodeCheck.reason } : undefined,
      order: {
        id: order.id,
        name: order.name,
        customer: order.customer,
        fulfillment_status: order.fulfillment_status,
        tags: alreadyTagged ? order.tags : [order.tags, "dispatch"].filter(Boolean).join(", "),
      },
    });
  } catch (err: any) {
    console.error("[Fulfilment] tag-dispatch error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

router.post("/tag-dispatch-bulk", requireFulfilmentAccess, async (req: Request, res: Response) => {
  // `orderIds` is the precise path: the picking screen can filter by multiple
  // box categories, arbitrary order tags and products, and the server cannot
  // re-derive that from a single `category` string. When the client sends the
  // ids it has actually filtered to, we tag exactly those — what the operator
  // sees is what gets tagged. `category` remains for older callers.
  const { tag, category, orderIds } = req.body as {
    tag?: string; category?: string; orderIds?: number[];
  };
  if (!tag) {
    res.status(400).json({ error: "tag is required" });
    return;
  }
  if (!orderIds && !category) {
    res.status(400).json({ error: "orderIds or category is required" });
    return;
  }
  const validCategories = ["small box", "large box", "wholesale", "other", "all"];
  if (!orderIds && category && !validCategories.includes(category)) {
    res.status(400).json({ error: `Invalid category. Must be one of: ${validCategories.join(", ")}` });
    return;
  }

  try {
    const orders = await getOrdersByTag(tag);
    const unfulfilled = orders.filter(o => o.fulfillment_status !== "fulfilled");
    const untagged = unfulfilled.filter(o =>
      !o.tags.split(",").map(t => t.trim()).includes("dispatch")
    );

    // Even when ids are supplied, only ever tag orders that are genuinely
    // untagged and unfulfilled *within this date tag* — a stale or hand-crafted
    // id can't reach an order outside the day being picked.
    const toTag = orderIds
      ? untagged.filter(o => orderIds.includes(o.id))
      : category === "all"
        ? untagged
        : untagged.filter(o => {
            const tags = o.tags.split(",").map(t => t.trim().toLowerCase());
            if (category === "wholesale") return tags.includes("wholesale");
            if (category === "large box") return tags.includes("large box");
            if (category === "small box") return tags.includes("small box");
            return !tags.includes("wholesale") && !tags.includes("large box") && !tags.includes("small box");
          });

    let tagged = 0;
    const postcodeIssues: Array<{ orderName: string; reason: string }> = [];
    // Same gate as /tag-dispatch: only pre-validate postcodes when the app
    // itself will create the APC consignments.
    // Auto-validate postcodes only in "full" mode, where the app itself books
    // the consignment and a bad postcode would fail at label time. In
    // "reconcile" mode consignments are uploaded to APC by hand — APC flags
    // service problems there, so a stored failure here must never gate the
    // scanner (2026-07-29: stale LW16 rejections blocked the whole pick list).
    const apcEnabledForTagging = (await getApcMode()) === "full";
    for (const order of toTag) {
      await addTagToOrder(order.id, order.tags, "dispatch");
      tagged++;

      if (apcEnabledForTagging && isApcConfigured()) {
        const check = await validateOrderPostcode(order, tag);
        if (!check.available) {
          postcodeIssues.push({ orderName: order.name, reason: check.reason ?? "Service not available" });
        }
      }
    }

    res.json({ ok: true, tagged, total: toTag.length, postcodeIssues });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Fulfilment] tag-dispatch-bulk error:", msg);
    res.status(502).json({ error: msg });
  }
});

// ── Batch consignment booking ──────────────────────────────────────────────
// Booking the whole wave in one go replaces the spreadsheet upload. The risk
// Graeme named is not the booking itself — it's a partial failure nobody
// notices, leaving some orders without a label and no way to tell which.
// So the flow is deliberately two-stage: a preflight that reports everything
// questionable BEFORE anything is booked, then a batch that reports the
// outcome of every single order individually and never fails silently.

type PreflightOrder = {
  orderId: number;
  orderName: string;
  customerName: string;
  serviceCode: string | null;
  boxCategory: "small box" | "large box" | "wholesale" | "other";
  weightKg: number;
  existingWaybill: string | null;
  problems: string[];
  reviews: string[];
};

async function buildPreflight(tag: string, dispatchDate: Date) {
  const [smallWeekday, largeWeekday, smallFriday, largeFriday, weightThreshStr] = await Promise.all([
    getAppSetting("apc_service_code_small_weekday"),
    getAppSetting("apc_service_code_large_weekday"),
    getAppSetting("apc_service_code_small_friday"),
    getAppSetting("apc_service_code_large_friday"),
    getAppSetting("apc_weight_threshold_grams"),
  ]);
  const codesConfigured = !!(smallWeekday && largeWeekday && smallFriday && largeFriday);
  const weightThresholdG = Number(weightThreshStr) || 1000;

  const { normaliseAddress } = await import("../services/apc");
  const orders = (await getOrdersByTag(tag)).filter(o =>
    o.fulfillment_status !== "fulfilled" &&
    o.tags.split(",").map(t => t.trim().toLowerCase()).includes("dispatch"),
  );

  const ready: PreflightOrder[] = [];
  const needsReview: PreflightOrder[] = [];
  const blocked: PreflightOrder[] = [];
  const alreadyBooked: PreflightOrder[] = [];
  const localDeliveries: PreflightOrder[] = [];

  for (const order of orders) {
    const tags = order.tags.split(",").map(t => t.trim().toLowerCase());
    const boxCategory: PreflightOrder["boxCategory"] =
      tags.includes("wholesale") ? "wholesale"
        : tags.includes("large box") ? "large box"
          : tags.includes("small box") ? "small box"
            : "other";

    const row: PreflightOrder = {
      orderId: order.id,
      orderName: order.name,
      customerName: order.shipping_address?.name
        ?? `${order.customer?.first_name ?? ""} ${order.customer?.last_name ?? ""}`.trim(),
      serviceCode: codesConfigured
        ? pickServiceCode(order, { smallWeekday: smallWeekday!, largeWeekday: largeWeekday!, smallFriday: smallFriday!, largeFriday: largeFriday! }, weightThresholdG, dispatchDate)
        : null,
      boxCategory,
      weightKg: Math.round((order.total_weight ?? 0) / 100) / 10,
      existingWaybill: null,
      problems: [],
      reviews: [],
    };

    // Local deliveries go on the van — they must never get a consignment.
    if (tags.includes("local-delivery")) {
      localDeliveries.push(row);
      continue;
    }

    const live = await liveConsignmentFor(order.id);
    if (live) {
      row.existingWaybill = live.waybill;
      alreadyBooked.push(row);
      continue;
    }

    const sa = order.shipping_address;
    if (!sa) row.problems.push("No shipping address");
    else {
      if (!sa.address1?.trim()) row.problems.push("No street address");
      if (!sa.zip?.trim()) row.problems.push("No postcode");
      if (!sa.city?.trim()) row.problems.push("No town");
      const norm = normaliseAddress(sa.address1 ?? "", sa.address2 ?? undefined, sa.city ?? "", { postcode: sa.zip, countryCode: sa.country_code ?? "GB" });
      for (const flag of norm.review) row.reviews.push(flag.message);
      for (const w of norm.warnings) row.reviews.push(w);
    }
    if (!codesConfigured) row.problems.push("APC service codes not configured in Settings");

    if (row.problems.length > 0) blocked.push(row);
    else if (row.reviews.length > 0) needsReview.push(row);
    else ready.push(row);
  }

  return {
    tag,
    codesConfigured,
    counts: {
      total: orders.length,
      ready: ready.length,
      needsReview: needsReview.length,
      blocked: blocked.length,
      alreadyBooked: alreadyBooked.length,
      localDeliveries: localDeliveries.length,
    },
    ready, needsReview, blocked, alreadyBooked, localDeliveries,
  };
}

// GET /batch-preflight?tag=YYYY-MM-DD — what WOULD happen. Books nothing.
router.get("/batch-preflight", requireFulfilmentAccess, async (req: Request, res: Response) => {
  const { tag, dispatchDate } = req.query as { tag?: string; dispatchDate?: string };
  if (!tag) { res.status(400).json({ error: "tag query param required" }); return; }
  try {
    res.json(await buildPreflight(tag, dispatchDate ? new Date(dispatchDate) : new Date(tag)));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Fulfilment] batch-preflight error:", msg);
    res.status(502).json({ error: msg });
  }
});

// POST /batch-book — body { tag, orderIds[], dispatchDate? }
// Books each order in turn. One order failing never stops the rest, and every
// order comes back with its own outcome so a partial run is fully accounted
// for. Orders that already hold a live consignment are skipped, not re-booked.
router.post("/batch-book", requireFulfilmentAccess, async (req: Request, res: Response) => {
  const parsed = z.object({
    tag: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    orderIds: z.array(z.number()).min(1).max(500),
    dispatchDate: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "tag and orderIds[] are required" }); return; }
  if (!isApcConfigured()) { res.status(503).json({ error: "APC credentials not configured." }); return; }

  const { tag, orderIds } = parsed.data;
  const dispatchDate = parsed.data.dispatchDate ? new Date(parsed.data.dispatchDate) : new Date(tag);
  const bookedBy = await resolveUserName(req);

  try {
    const [smallWeekday, largeWeekday, smallFriday, largeFriday, weightThreshStr, testModeSetting] = await Promise.all([
      getAppSetting("apc_service_code_small_weekday"),
      getAppSetting("apc_service_code_large_weekday"),
      getAppSetting("apc_service_code_small_friday"),
      getAppSetting("apc_service_code_large_friday"),
      getAppSetting("apc_weight_threshold_grams"),
      getAppSetting("apc_test_mode"),
    ]);
    if (!smallWeekday || !largeWeekday || !smallFriday || !largeFriday) {
      res.status(400).json({ error: "APC service codes not configured. Set all four in Settings." });
      return;
    }
    const apiBase = testModeSetting === "true" ? APC_TRAINING_BASE : undefined;
    const weightThresholdG = Number(weightThreshStr) || 1000;

    const all = await getOrdersByTag(tag);
    const wanted = new Set(orderIds);
    const orders = all.filter(o => wanted.has(o.id));

    const results: Array<{
      orderId: number; orderName: string;
      status: "booked" | "skipped" | "failed";
      waybill?: string; serviceCode?: string; reference?: string;
      reason?: string; recordError?: string;
    }> = [];

    for (const order of orders) {
      const tagsLower = order.tags.split(",").map(t => t.trim().toLowerCase());
      if (tagsLower.includes("local-delivery")) {
        results.push({ orderId: order.id, orderName: order.name, status: "skipped", reason: "Local delivery — no courier label" });
        continue;
      }
      const live = await liveConsignmentFor(order.id);
      if (live) {
        results.push({ orderId: order.id, orderName: order.name, status: "skipped", reason: "Already has a consignment", waybill: live.waybill });
        continue;
      }
      if (!order.shipping_address?.address1 || !order.shipping_address?.zip) {
        results.push({ orderId: order.id, orderName: order.name, status: "failed", reason: "Missing address or postcode" });
        continue;
      }

      const serviceCode = pickServiceCode(order, { smallWeekday, largeWeekday, smallFriday, largeFriday }, weightThresholdG, dispatchDate);
      const reference = order.name;
      const sa = order.shipping_address;
      let specialInstructions = "X227 - PERISHABLE";
      if (order.note?.trim()) specialInstructions = `${specialInstructions} ${order.note.trim()}`.slice(0, 50);

      try {
        const result = await createShipment({
          serviceCode,
          companyName: sa.company?.trim() || "Home Delivery",
          recipient: {
            name: sa.name || `${order.customer?.first_name ?? ""} ${order.customer?.last_name ?? ""}`.trim(),
            address1: sa.address1,
            address2: sa.address2,
            city: sa.city,
            postcode: sa.zip,
            country: sa.country_code ?? "GB",
            phone: sa.phone ?? order.customer?.phone,
            email: order.customer?.email,
          },
          parcels: [{ weight: Math.max(0.1, (order.total_weight ?? 500) / 1000) }],
          reference,
          specialInstructions,
          ...(apiBase ? { apiBase } : {}),
        });

        const recordError = await recordConsignment({
          waybill: result.consignmentNumber,
          reference,
          orderId: order.id,
          orderName: order.name,
          postcode: sa.zip,
          trackingUrl: result.trackingUrl ?? null,
          serviceCode,
          dispatchTag: tag,
          bookedBy,
        });

        results.push({
          orderId: order.id, orderName: order.name, status: "booked",
          waybill: result.consignmentNumber, serviceCode, reference,
          ...(recordError ? { recordError } : {}),
        });
      } catch (bookErr) {
        const msg = bookErr instanceof Error ? bookErr.message : String(bookErr);
        console.error(`[Fulfilment] batch-book FAILED for ${order.name}:`, msg);
        results.push({ orderId: order.id, orderName: order.name, status: "failed", reason: msg });
      }
    }

    const missing = orderIds.filter(id => !results.some(r => r.orderId === id));
    for (const id of missing) {
      results.push({ orderId: id, orderName: `(order ${id})`, status: "failed", reason: "Order not found on this dispatch day" });
    }

    res.json({
      tag,
      booked: results.filter(r => r.status === "booked").length,
      skipped: results.filter(r => r.status === "skipped").length,
      failed: results.filter(r => r.status === "failed").length,
      recordErrors: results.filter(r => r.recordError).length,
      results,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Fulfilment] batch-book error:", msg);
    res.status(502).json({ error: msg });
  }
});

// GET /booked-not-dispatched?tag= — end of day: consignments raised for this
// dispatch day whose Shopify order never got fulfilled. Each one is a label
// APC may still collect against, so they need cancelling or explaining.
router.get("/booked-not-dispatched", requireFulfilmentAccess, async (req: Request, res: Response) => {
  const { tag } = req.query as { tag?: string };
  if (!tag) { res.status(400).json({ error: "tag query param required" }); return; }
  try {
    const rows = await db.execute<{ waybill: string; shopify_order_id: string; shopify_order_name: string; service_code: string | null; booked_by: string | null; created_at: Date; label_printed_at: Date | null }>(sql`
      SELECT waybill, shopify_order_id, shopify_order_name, service_code, booked_by, created_at, label_printed_at
      FROM apc_consignments
      WHERE dispatch_tag = ${tag} AND cancelled_at IS NULL
      ORDER BY created_at
    `);
    if (rows.rows.length === 0) { res.json({ tag, outstanding: [] }); return; }

    const orders = await getOrdersByTag(tag);
    const fulfilled = new Set(orders.filter(o => o.fulfillment_status === "fulfilled").map(o => o.id));
    const outstanding = rows.rows
      .filter(r => !fulfilled.has(Number(r.shopify_order_id)))
      .map(r => ({
        waybill: r.waybill,
        orderId: Number(r.shopify_order_id),
        orderName: r.shopify_order_name,
        serviceCode: r.service_code,
        bookedBy: r.booked_by,
        bookedAt: r.created_at,
        labelPrinted: !!r.label_printed_at,
      }));
    res.json({ tag, checked: rows.rows.length, outstanding });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Fulfilment] booked-not-dispatched error:", msg);
    res.status(502).json({ error: msg });
  }
});

// POST /consignments/:waybill/mark-cancelled
// APC's API reports a cancelled consignment exactly like a live one — the
// reference lookup still returns it and the waybill lookup still answers
// SUCCESS with a label (verified 2026-08-12). So a cancellation made inside
// Hypaship is invisible to us and we cannot detect it automatically. This is
// the manual escape hatch: it marks our record dead so the order can be
// re-booked under the same order number. It does NOT call APC — the
// consignment is already cancelled there.
router.post("/consignments/:waybill/mark-cancelled", requireFulfilmentAccess, async (req: Request, res: Response) => {
  const { waybill } = req.params;
  if (!waybill) { res.status(400).json({ error: "waybill required" }); return; }
  try {
    const result = await db.execute(sql`
      UPDATE apc_consignments SET cancelled_at = NOW()
      WHERE waybill = ${waybill} AND cancelled_at IS NULL
      RETURNING shopify_order_name
    `);
    if (result.rows.length === 0) {
      res.status(404).json({ error: "No live consignment with that number" });
      return;
    }
    console.log(`[Fulfilment] ${waybill} marked cancelled by hand (cancelled in APC directly)`);
    res.json({ ok: true, orderName: (result.rows[0] as { shopify_order_name: string }).shopify_order_name });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Fulfilment] mark-cancelled error:", msg);
    res.status(500).json({ error: msg });
  }
});

// GET /consignments?tag=YYYY-MM-DD
// Which orders on this dispatch day already have an APC consignment booked.
// Lets the picking screen tell the packer the truth BEFORE they commit —
// "this order already has a consignment, it will be reused" rather than
// "this will create a real consignment". Reads our own ledger only, so it's
// a cheap local query with no APC round-trip.
router.get("/consignments", requireFulfilmentAccess, async (req: Request, res: Response) => {
  const { tag } = req.query as { tag?: string };
  if (!tag) {
    res.status(400).json({ error: "tag query param required" });
    return;
  }
  try {
    const orders = await getOrdersByTag(tag);
    const ids = orders.map(o => o.id);
    if (ids.length === 0) { res.json({ tag, consignments: [] }); return; }
    const rows = await db.execute<{ shopify_order_id: string; waybill: string; tracking_url: string | null; label_printed_at: Date | null }>(sql`
      SELECT DISTINCT ON (shopify_order_id) shopify_order_id, waybill, tracking_url, label_printed_at
      FROM apc_consignments
      WHERE shopify_order_id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
        AND cancelled_at IS NULL
      ORDER BY shopify_order_id, created_at DESC
    `);
    res.json({
      tag,
      consignments: rows.rows.map(r => ({
        orderId: Number(r.shopify_order_id),
        waybill: r.waybill,
        trackingUrl: r.tracking_url,
        labelPrintedAt: r.label_printed_at,
      })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Fulfilment] consignments error:", msg);
    res.status(502).json({ error: msg });
  }
});

router.get("/postcode-validations", requireFulfilmentAccess, async (req: Request, res: Response) => {
  const { tag } = req.query as { tag?: string };
  if (!tag) {
    res.status(400).json({ error: "tag query param required" });
    return;
  }
  try {
    const rows = await db.execute(sql`
      SELECT DISTINCT ON (shopify_order_id) shopify_order_id, postcode, service_code, available, reason, checked_at
      FROM postcode_validations
      WHERE dispatch_tag = ${tag}
      ORDER BY shopify_order_id, checked_at DESC
    `);
    res.json(rows.rows);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Fulfilment] postcode-validations error:", msg);
    res.status(500).json({ error: msg });
  }
});

// GET /address-review?tag=YYYY-MM-DD
// Runs every order for a dispatch day through the APC address normaliser and
// returns only the ones it could not resolve confidently — a conflicting
// postcode, a town too long for APC's 35-character field. Read-only: it books
// nothing and calls no external service, it just reshapes the addresses we
// already hold and reports what a human should look at before a label is
// printed. Replaces hunting for yellow cells in the spreadsheet.
router.get("/address-review", requireFulfilmentAccess, async (req: Request, res: Response) => {
  const { tag } = req.query as { tag?: string };
  if (!tag) {
    res.status(400).json({ error: "tag query param required" });
    return;
  }
  try {
    const { normaliseAddress } = await import("../services/apc");
    const orders = await getOrdersByTag(tag);
    const flagged = orders
      .filter(o => o.fulfillment_status !== "fulfilled" && o.shipping_address)
      .map(o => {
        const sa = o.shipping_address!;
        const result = normaliseAddress(sa.address1, sa.address2, sa.city, {
          postcode: sa.zip,
          countryCode: sa.country_code ?? "GB",
        });
        return {
          orderId: o.id,
          orderName: o.name,
          review: result.review,
          normalised: {
            address1: result.address1,
            address2: result.address2 ?? null,
            city: result.city,
            postcode: sa.zip,
          },
        };
      })
      .filter(r => r.review.length > 0);
    res.json({ tag, checked: orders.length, flagged });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Fulfilment] address-review error:", msg);
    res.status(502).json({ error: msg });
  }
});

router.post("/postcode-recheck", requireFulfilmentAccess, async (req: Request, res: Response) => {
  const { orderId, tag } = req.body as { orderId?: number; tag?: string };
  if (!orderId || !tag) {
    res.status(400).json({ error: "orderId and tag are required" });
    return;
  }

  try {
    const orders = await getOrdersByTag(tag);
    const order = orders.find(o => o.id === orderId);
    if (!order) {
      res.status(404).json({ error: `Order #${orderId} not found in tag "${tag}"` });
      return;
    }

    const result = await validateOrderPostcode(order, tag);
    res.json({
      orderId,
      postcode: order.shipping_address?.zip ?? "",
      serviceCode: result.serviceCode,
      available: result.available,
      reason: result.reason,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Fulfilment] postcode-recheck error:", msg);
    res.status(502).json({ error: msg });
  }
});

router.post("/postcode-validate-tag", requireFulfilmentAccess, async (req: Request, res: Response) => {
  const { tag } = req.body as { tag?: string };
  if (!tag) {
    res.status(400).json({ error: "tag is required" });
    return;
  }

  try {
    const orders = await getOrdersByTag(tag);
    const unfulfilled = orders.filter(o => o.fulfillment_status !== "fulfilled");
    const dispatched = unfulfilled.filter(o =>
      o.tags.split(",").map(t => t.trim()).includes("dispatch")
    );

    let checked = 0;
    const issues: Array<{ orderName: string; orderId: number; reason: string }> = [];

    for (const order of dispatched) {
      const result = await validateOrderPostcode(order, tag);
      checked++;
      if (!result.available) {
        issues.push({ orderName: order.name, orderId: order.id, reason: result.reason ?? "Service not available" });
      }
    }

    res.json({ ok: true, checked, issues });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Fulfilment] postcode-validate-tag error:", msg);
    res.status(502).json({ error: msg });
  }
});

// Marker tag we set on every Shopify order we've decremented production_fridge
// stock for. Two paths set it: the in-app fulfil flow at POST /orders/:id/complete
// and the manual "Process Fulfilled Today" button below. Both consult the tag
// (via Shopify's `-tag:` search filter) to avoid double-decrementing the same
// order — historically /complete used a separate shopify_fulfilment_tracking
// table for this, which the button never read, so an order fulfilled in-app
// would still be re-decremented on the next button click.
const FACTORY_NUMBER_TAG = "factory-number-adjusted";

// Marker tag we set after the in-app picker has successfully called Shopify's
// fulfilOrder endpoint and Shopify confirmed the fulfilment. Lets the
// end-of-dispatch audit answer "did the app actually fulfil this in Shopify,
// or did Shopify silently reject it?" without re-querying Shopify per order.
const FULFILLED_BY_APP_TAG = "fulfilled-by-app";

const CompleteOrderBody = z.object({
  // Optional when apc_enabled = "false" in app_settings. We re-check
  // the flag below and require a non-empty consignment when APC is on.
  consignmentNumber: z.string().optional(),
  trackingUrl: z.string().optional(),
});

router.post("/orders/:id/complete", requireFulfilmentAccess, async (req: Request, res: Response) => {
  const orderId = Number(req.params.id);
  if (isNaN(orderId)) {
    res.status(400).json({ error: "Invalid order ID" });
    return;
  }

  const parsed = CompleteOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const apcMode = await getApcMode();
  const apcEnabled = apcMode !== "off";
  const { consignmentNumber, trackingUrl } = parsed.data;
  // Both "full" (label booked via API) and "reconcile" (label scanned off a
  // hand-raised consignment) must arrive with a number — shipping an order
  // with no tracking is exactly the failure this flow exists to prevent.
  // The one exception: orders tagged local-delivery go on the van, not APC,
  // so there is no consignment by definition. Verified from the order's own
  // tags in Shopify — never a client flag — because this is the
  // anti-mis-ship gate.
  let order: Awaited<ReturnType<typeof getOrderById>> = null;
  let localDelivery = false;
  if (apcEnabled && !consignmentNumber) {
    order = await getOrderById(orderId);
    localDelivery = (order?.tags ?? "")
      .split(",")
      .map(t => t.trim().toLowerCase())
      .includes("local-delivery");
    if (!localDelivery) {
      res.status(400).json({ error: `consignmentNumber is required when apc_mode is "${apcMode}"` });
      return;
    }
  }

  // Order of operations is deliberate: Shopify fulfilment FIRST, stock
  // decrement only after Shopify confirms. If Shopify rejects the order
  // (no open fulfillment_orders, cancelled, etc.) we don't touch the
  // factory number — better to leave stock untouched and surface the
  // error than to deduct for an order that never shipped.
  //
  // Tags written after Shopify success let the end-of-dispatch audit
  // distinguish three failure modes:
  //   no tags        → app never tried this order
  //   only fulfilled-by-app → Shopify shipped, but stock decrement failed
  //   both tags      → fully successful

  // 1. Shopify fulfilment — the slow, fragile, customer-facing call.
  // Local deliveries fulfil with a carrier name but no tracking number, so
  // the customer's dispatch email says "TCK Local Delivery" instead of
  // carrying an APC tracking link.
  try {
    await fulfillOrder(
      orderId,
      apcEnabled && !localDelivery ? consignmentNumber! : "",
      localDelivery ? "TCK Local Delivery" : apcEnabled ? "APC Overnight" : "",
      apcEnabled && !localDelivery ? trackingUrl : undefined,
    );
    // Shopify has the tracking number — close the ledger row so an
    // end-of-dispatch audit can tell "scanned but never pushed" from "done".
    if (consignmentNumber) await markConsignmentPushed(consignmentNumber);
  } catch (err: any) {
    console.error(`[Fulfilment] completeOrder fulfilOrder FAILED for order ${orderId}:`, err.message);
    res.status(502).json({ error: err.message });
    return;
  }

  // 2. Tag the order so the audit can confirm we shipped it.
  try {
    if (!order) order = await getOrderById(orderId);
    await addTagToOrder(orderId, order?.tags ?? "", FULFILLED_BY_APP_TAG);
  } catch (tagErr) {
    const msg = tagErr instanceof Error ? tagErr.message : String(tagErr);
    console.warn(`[Fulfilment] ${FULFILLED_BY_APP_TAG} tag write FAILED for order ${orderId} (Shopify fulfilment did succeed):`, msg);
  }

  // 3. Decrement production_fridge stock + add factory-number-adjusted tag.
  // Idempotent via shopify_fulfilment_tracking — never double-decrements
  // even if /complete is called twice for the same order.
  let decrementError: string | null = null;
  try {
    const [existing] = await db
      .select({ shopifyOrderId: shopifyFulfilmentTrackingTable.shopifyOrderId })
      .from(shopifyFulfilmentTrackingTable)
      .where(eq(shopifyFulfilmentTrackingTable.shopifyOrderId, orderId));
    if (!existing) {
      if (!order) order = await getOrderById(orderId);
      if (order?.line_items && order.line_items.length > 0) {
        const result = await decrementFridgeForShopifyOrder(orderId, order.line_items);
        if (result.unmapped.length > 0) {
          console.warn(`[Fulfilment] order ${orderId} — unmapped variant ids:`, result.unmapped.join(", "));
        }
        if (result.decremented.length > 0) {
          console.log(`[Fulfilment] order ${orderId} — decremented`, result.decremented);
        }
        await db.insert(shopifyFulfilmentTrackingTable).values({
          shopifyOrderId: orderId,
          fulfilledAt: new Date(),
          source: "immediate",
        }).onConflictDoNothing();
        try {
          await addTagToOrder(orderId, order.tags ?? "", FACTORY_NUMBER_TAG);
        } catch (tagErr) {
          const msg = tagErr instanceof Error ? tagErr.message : String(tagErr);
          console.warn(`[Fulfilment] ${FACTORY_NUMBER_TAG} tag write FAILED for order ${orderId}:`, msg);
        }
      }
    }
  } catch (err: any) {
    decrementError = err.message ?? String(err);
    console.error(`[Fulfilment] inventory decrement failed for order ${orderId}:`, err);
  }

  // Shopify is shipped, customer is emailed. Even if the decrement failed,
  // we return 200 so the picker advances — the audit endpoint will surface
  // the missing factory-number tag for the operator to follow up.
  res.json({
    ok: true,
    orderId,
    consignmentNumber: consignmentNumber ?? null,
    decrementError,
  });
});

// ── Manual "Process Fulfilled Today" button ────────────────────────────────
// Replaces the old 5-minute fulfilment-poller (see index.ts note dated
// 2026-04-17). The user clicks this from the Production Plans page or
// the Stock Control → production_fridge panel, and we:
//   1. Query Shopify GraphQL for orders fulfilled today AND not yet
//      carrying the FACTORY_NUMBER_TAG.
//   2. Decrement production_fridge stock for each (same helper the
//      /orders/:id/complete path uses).
//   3. Tag each processed order with FACTORY_NUMBER_TAG so a second
//      click in the same day won't double-decrement.
//
// Dedup lives on the Shopify order itself (the tag), NOT in our local
// shopify_fulfilment_tracking table — Shopify is the source of truth,
// so a DB wipe or staging restore can't cause double-decrements.
// FACTORY_NUMBER_TAG is declared above (used by both /orders/:id/complete and
// the button — single source of truth for "this order's already been
// decremented, don't decrement again").

/**
 * Compute midnight of the current London calendar day as a UTC ISO
 * timestamp. Works correctly in both BST and GMT: we ask for the
 * current London date (en-CA gives YYYY-MM-DD), then measure London's
 * UTC offset using a noon probe (safely inside the day, away from the
 * DST-transition hour).
 */
function londonMidnightTodayUtc(): string {
  const londonDateStr = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const probe = new Date(`${londonDateStr}T12:00:00Z`);
  const londonNoon = probe.toLocaleString("sv-SE", { timeZone: "Europe/London" });
  const offsetHours = 12 - parseInt(londonNoon.slice(11, 13), 10);
  const midnight = new Date(`${londonDateStr}T00:00:00Z`);
  midnight.setUTCHours(midnight.getUTCHours() + offsetHours);
  return midnight.toISOString();
}

interface GqlOrderNode {
  id: string;            // "gid://shopify/Order/12345"
  name: string;
  updatedAt: string;
  tags: string[];
  lineItems: {
    edges: Array<{
      node: {
        quantity: number;
        title: string;
        sku: string | null;
        variant: { id: string } | null;
      };
    }>;
  };
}

// "Update Factory Number" — decrements production-fridge stock from today's
// fulfilled orders. Deliberately open to ANY logged-in user (not just
// managers): packers need to run this from the packing station. Login is
// still required via the global auth guard in routes/index.ts. The action is
// idempotent — already-processed orders are skipped via a Shopify tag — so
// there's no harm in a viewer triggering it.
router.post("/process-fulfilled-today", async (_req: Request, res: Response) => {
  try {
    const midnightIso = londonMidnightTodayUtc();

    // Fetch today's fulfilled + untagged orders WITH line items in a
    // single GraphQL round trip. -tag: is the Shopify search negation
    // operator (verified against live API).
    const gqlQuery = `{
      orders(
        first: 250,
        query: "fulfillment_status:fulfilled AND updated_at:>='${midnightIso}' AND -tag:${FACTORY_NUMBER_TAG}"
      ) {
        edges { node {
          id name updatedAt tags
          lineItems(first: 100) {
            edges { node { quantity title sku variant { id } } }
          }
        } }
        pageInfo { hasNextPage }
      }
    }`;

    const data = await shopifyGraphQL<{
      orders: { edges: Array<{ node: GqlOrderNode }>; pageInfo: { hasNextPage: boolean } };
    }>(gqlQuery);

    const edges = data.orders.edges;

    if (data.orders.pageInfo.hasNextPage) {
      // TCK's daily fulfilled-order volume doesn't approach 250 —
      // hitting this means either a backlog from a long outage or an
      // unexpected volume spike. Log and process the first 250 anyway;
      // the user can click again for the remainder.
      console.warn(
        "[process-fulfilled-today] Shopify reports >250 untagged fulfilled orders today; processing first 250 only",
      );
    }

    const perRecipeMap = new Map<number, number>();
    const unmappedSet = new Set<string>();
    let processedCount = 0;
    let decrementedPacks = 0;
    let skippedNonCore = 0;
    const errors: Array<{ orderId: number; orderName: string; stage: "decrement" | "tag"; message: string }> = [];

    // Chunked parallel processing. At 5 concurrent calls we stay well
    // under Shopify's 4 req/s REST leaky-bucket (the tag-write uses
    // REST PUT); bursts are absorbed by the bucket.
    const CHUNK = 5;
    for (let i = 0; i < edges.length; i += CHUNK) {
      const chunk = edges.slice(i, i + CHUNK);
      await Promise.all(chunk.map(async (edge) => {
        const node = edge.node;
        const orderIdNum = Number(node.id.split("/").pop());
        if (!Number.isFinite(orderIdNum) || orderIdNum <= 0) {
          errors.push({ orderId: 0, orderName: node.name, stage: "decrement", message: `could not parse order id from ${node.id}` });
          return;
        }

        // Translate GraphQL line items to the REST shape
        // decrementFridgeForShopifyOrder expects.
        const lineItems: ShopifyLineItem[] = node.lineItems.edges.map(li => ({
          id: 0, // unused downstream
          variant_id: li.node.variant?.id ? (Number(li.node.variant.id.split("/").pop()) || null) : null,
          product_id: null, // not fetched via GraphQL; unused downstream
          title: li.node.title,
          variant_title: null,
          quantity: li.node.quantity,
          sku: li.node.sku ?? "",
          price: "0", // unused
        }));

        // 1. Decrement production_fridge stock
        try {
          const dec = await decrementFridgeForShopifyOrder(orderIdNum, lineItems);
          for (const r of dec.decremented) {
            perRecipeMap.set(r.recipeId, (perRecipeMap.get(r.recipeId) ?? 0) + r.packs);
            decrementedPacks += r.packs;
          }
          for (const u of dec.unmapped) unmappedSet.add(u);
          skippedNonCore += dec.skippedNonCore;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({ orderId: orderIdNum, orderName: node.name, stage: "decrement", message: msg });
          console.error(`[process-fulfilled-today] decrement failed for ${node.name}:`, msg);
          return; // skip tagging — order will be retried next click
        }

        // 2. Tag the order so the next click excludes it. If this
        // fails after a successful decrement, the order may be
        // re-decremented on the next click — rare, logged, accepted.
        try {
          const currentTagsCsv = node.tags.join(", ");
          await addTagToOrder(orderIdNum, currentTagsCsv, FACTORY_NUMBER_TAG);
          processedCount += 1;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({ orderId: orderIdNum, orderName: node.name, stage: "tag", message: msg });
          console.warn(
            `[process-fulfilled-today] TAG WRITE FAILED for ${node.name} AFTER successful decrement — this order may be reprocessed on next click:`,
            msg,
          );
        }
      }));
    }

    const perRecipe = [...perRecipeMap.entries()]
      .map(([recipeId, packs]) => ({ recipeId, packs }))
      .sort((a, b) => b.packs - a.packs);

    const response = {
      processedCount,
      alreadyTaggedCount: 0, // GraphQL -tag filter means we never fetch already-tagged orders; kept in the response shape for future symmetry
      decrementedPacks,
      perRecipe,
      unmappedVariants: [...unmappedSet],
      skippedNonCore,
      errors,
    };

    console.log(
      `[process-fulfilled-today] processed ${processedCount}/${edges.length} orders, decremented ${decrementedPacks} packs across ${perRecipe.length} recipes, ${unmappedSet.size} unmapped variants, ${errors.length} errors`,
    );
    res.json(response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[process-fulfilled-today] top-level error:", msg);
    res.status(502).json({ error: msg });
  }
});

router.get("/sku-locations", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(skuLocationsTable).orderBy(skuLocationsTable.sku);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Returns all unique SKUs seen in recent Shopify orders, with their location assignment status
router.get("/sku-locations/recent-skus", requireAdmin, async (req: Request, res: Response) => {
  const { tag } = req.query as { tag?: string };
  try {
    // If a specific dispatch tag is provided, use it. Otherwise fall back to
    // all recent unfulfilled orders (last 14 days) so the Bin Locations page
    // can show a broad SKU inventory without requiring a specific date tag.
    const [orders, existingLocations] = await Promise.all([
      tag ? getOrdersByTag(tag) : getRecentUnfulfilledOrders(14),
      db.select().from(skuLocationsTable),
    ]);

    const locationBySku = new Map(existingLocations.map(l => [l.sku, l]));

    // Collect unique SKUs from recent orders
    const skuMap = new Map<string, { sku: string; title: string; orderCount: number; location: (typeof existingLocations)[0] | null }>();
    for (const order of orders) {
      for (const item of order.line_items) {
        if (!item.sku) continue;
        const existing = skuMap.get(item.sku);
        if (existing) {
          existing.orderCount++;
        } else {
          skuMap.set(item.sku, {
            sku: item.sku,
            title: item.title,
            orderCount: 1,
            location: locationBySku.get(item.sku) ?? null,
          });
        }
      }
    }

    const result = Array.from(skuMap.values()).sort((a, b) => {
      // Unassigned first, then by SKU
      if (!a.location && b.location) return -1;
      if (a.location && !b.location) return 1;
      return a.sku.localeCompare(b.sku);
    });

    res.json(result);
  } catch (err: any) {
    console.error("[Fulfilment] recent-skus error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

const UpsertLocationBody = z.object({
  zone: z.enum(["fridge", "freezer", "ambient"]),
  locationLabel: z.string().min(1, "Location label is required"),
});

router.put("/sku-locations/:sku", requireAdmin, async (req: Request<{ sku: string }>, res: Response) => {
  const sku = decodeURIComponent(req.params.sku);
  const parsed = UpsertLocationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(", ") });
    return;
  }

  try {
    const [row] = await db
      .insert(skuLocationsTable)
      .values({ sku, zone: parsed.data.zone, locationLabel: parsed.data.locationLabel })
      .onConflictDoUpdate({
        target: skuLocationsTable.sku,
        set: { zone: parsed.data.zone, locationLabel: parsed.data.locationLabel, updatedAt: new Date() },
      })
      .returning();
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/sku-locations/:sku", requireAdmin, async (req: Request<{ sku: string }>, res: Response) => {
  const sku = decodeURIComponent(req.params.sku);
  try {
    await db.delete(skuLocationsTable).where(eq(skuLocationsTable.sku, sku));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Whether the picking page lets a packer mark items picked by tapping the
// row (in addition to scanning). Some sites want to lock down to scan-only
// to enforce the audit trail; others want manual tap as a fallback when a
// barcode is missing/damaged. Defaults to enabled.
const MANUAL_TICK_KEY = "fulfilment_manual_tick_enabled";

router.get("/manual-tick-config", async (_req: Request, res: Response) => {
  const value = await getAppSetting(MANUAL_TICK_KEY);
  // Default true — preserves the existing behaviour for sites that haven't
  // explicitly disabled tap-to-pick.
  const enabled = value === null ? true : value !== "false";
  res.json({ enabled });
});

router.put("/manual-tick-config", requireAdmin, async (req: Request, res: Response) => {
  const raw = (req.body as { enabled?: unknown } | undefined)?.enabled;
  if (typeof raw !== "boolean") {
    res.status(400).json({ error: "enabled (boolean) is required" });
    return;
  }
  await db
    .insert(appSettingsTable)
    .values({ key: MANUAL_TICK_KEY, value: String(raw) })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value: String(raw), updatedAt: new Date() },
    });
  res.json({ enabled: raw });
});

// Whether the picking page reads the customer's name aloud when an order
// opens. Defaults to enabled — the speech is a useful cross-check against
// the APC label, but a noisy kitchen may want it off.
const SPEAK_NAME_KEY = "fulfilment_speak_name_enabled";

router.get("/speak-name-config", async (_req: Request, res: Response) => {
  const value = await getAppSetting(SPEAK_NAME_KEY);
  const enabled = value === null ? true : value !== "false";
  res.json({ enabled });
});

router.put("/speak-name-config", requireAdmin, async (req: Request, res: Response) => {
  const raw = (req.body as { enabled?: unknown } | undefined)?.enabled;
  if (typeof raw !== "boolean") {
    res.status(400).json({ error: "enabled (boolean) is required" });
    return;
  }
  await db
    .insert(appSettingsTable)
    .values({ key: SPEAK_NAME_KEY, value: String(raw) })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value: String(raw), updatedAt: new Date() },
    });
  res.json({ enabled: raw });
});

router.get("/sku-barcodes", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(skuBarcodesTable).orderBy(skuBarcodesTable.sku);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Pulls every variant from Shopify and caches one row per VARIANT ID with
// its barcode, SKU, titles and image. The fulfilment scanner reads this
// cache to attach a barcode/image to each order line item (matched by
// variant id — SKUs are shelf labels shared across products, so they can't
// identify one). Safe to re-run — variants with empty barcodes are skipped,
// variants with new/changed barcodes overwrite. Variants with no SKU still
// sync: they have no bin location, but their barcode must scan (e.g. the
// first-order insert).
router.post("/sync-barcodes", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const products = await getProducts();

    let synced = 0;
    let skippedNoBarcode = 0;

    for (const product of products) {
      // Variant.image_id points at one of product.images. Fall back to the
      // featured product image if the variant has no specific image — the
      // packing thumbnail just needs to look like the product on the label.
      const imageById = new Map(product.images.map(img => [img.id, img.src]));
      const fallbackImage = product.image?.src ?? null;
      for (const variant of product.variants) {
        const barcode = (variant.barcode ?? "").trim();
        if (!barcode) { skippedNoBarcode++; continue; }

        const imageUrl = (variant.image_id && imageById.get(variant.image_id)) || fallbackImage;

        await db
          .insert(skuBarcodesTable)
          .values({
            variantId: String(variant.id),
            sku: variant.sku || null,
            barcode,
            productTitle: product.title,
            variantTitle: variant.title,
            imageUrl,
          })
          .onConflictDoUpdate({
            target: skuBarcodesTable.variantId,
            set: {
              sku: variant.sku || null,
              barcode,
              productTitle: product.title,
              variantTitle: variant.title,
              imageUrl,
              updatedAt: new Date(),
            },
          });
        synced++;
      }
    }

    res.json({ synced, skippedNoBarcode, skippedNoSku: 0, totalProducts: products.length });
  } catch (err: any) {
    console.error("[Fulfilment] sync-barcodes error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// End-of-dispatch audit: for each order on this dispatch tag, report
// whether Shopify shows it fulfilled and whether the app applied each of
// its two completion tags. Lets the operator (or a future automated check)
// answer "did everything I packed today actually ship + decrement stock?"
// without manually opening each order in Shopify Admin.
router.get("/dispatch-audit", requireFulfilmentAccess, async (req: Request, res: Response) => {
  const { tag } = req.query as { tag?: string };
  if (!tag) {
    res.status(400).json({ error: "tag query param required" });
    return;
  }
  try {
    const orders = await getOrdersByTag(tag);
    const rows = orders.map(o => {
      const tags = (o.tags ?? "").split(",").map(t => t.trim().toLowerCase());
      const fulfilledByApp = tags.includes(FULFILLED_BY_APP_TAG);
      const factoryAdjusted = tags.includes(FACTORY_NUMBER_TAG);
      const shopifyFulfilled = o.fulfillment_status === "fulfilled";
      // Status precedence: any failure is more interesting than success.
      let status: "ok" | "needs_decrement" | "needs_fulfilment" | "untouched" | "shopify_only";
      if (shopifyFulfilled && fulfilledByApp && factoryAdjusted) status = "ok";
      else if (shopifyFulfilled && !fulfilledByApp) status = "shopify_only";
      else if (fulfilledByApp && !factoryAdjusted) status = "needs_decrement";
      else if (!shopifyFulfilled && !fulfilledByApp) status = "needs_fulfilment";
      else status = "untouched";
      return {
        orderId: o.id,
        orderName: o.name,
        customerName: o.shipping_address?.name
          ?? (`${o.customer?.first_name ?? ""} ${o.customer?.last_name ?? ""}`.trim() || null),
        cancelledAt: o.cancelled_at,
        shopifyFulfillmentStatus: o.fulfillment_status,
        fulfilledByApp,
        factoryAdjusted,
        status,
      };
    });
    const summary = {
      total: rows.length,
      ok: rows.filter(r => r.status === "ok").length,
      needsFulfilment: rows.filter(r => r.status === "needs_fulfilment").length,
      needsDecrement: rows.filter(r => r.status === "needs_decrement").length,
      shopifyOnly: rows.filter(r => r.status === "shopify_only").length,
      untouched: rows.filter(r => r.status === "untouched").length,
    };
    res.json({ tag, summary, orders: rows });
  } catch (err: any) {
    console.error("[Fulfilment] dispatch-audit error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// Diagnostic — only operates on the user-confirmed test order #126508. Pulls
// the order + its fulfillment_orders via both REST and GraphQL so we can see
// exactly why Shopify won't accept fulfilment for this specific order.
// READ-ONLY — does not write to Shopify or to local DB.
router.get("/diagnose-test-order", requireAdmin, async (_req: Request, res: Response) => {
  const TEST_ORDER_ID = 13000825143670;
  try {
    // 1. REST endpoint we currently rely on
    const restFulfillmentOrders = (await shopifyGraphQL(`{
      order(id: "gid://shopify/Order/${TEST_ORDER_ID}") {
        id
        name
        displayFulfillmentStatus
        cancelledAt
        lineItems(first: 50) {
          edges { node {
            id
            title
            quantity
            requiresShipping
            variant { id sku inventoryItem { id tracked requiresShipping } }
            fulfillmentService { handle type }
          } }
        }
        fulfillmentOrders(first: 20) {
          edges { node {
            id
            status
            requestStatus
            assignedLocation { name location { id name } }
            supportedActions { action }
            lineItems(first: 50) {
              edges { node { id totalQuantity remainingQuantity } }
            }
          } }
        }
      }
    }`));
    res.json(restFulfillmentOrders);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

router.get("/dispatch-progress", async (req: Request, res: Response) => {
  const { tag } = req.query as { tag?: string };
  if (!tag) {
    res.status(400).json({ error: "tag query param required" });
    return;
  }

  try {
    const allOrders = await getOrdersByTag(tag);

    const categories = {
      smallBox: { total: 0, fulfilled: 0 },
      largeBox: { total: 0, fulfilled: 0 },
      wholesale: { total: 0, fulfilled: 0 },
      other: { total: 0, fulfilled: 0 },
    };

    for (const order of allOrders) {
      const tags = order.tags.split(",").map(t => t.trim().toLowerCase());
      const isFulfilled = order.fulfillment_status === "fulfilled";

      if (tags.includes("wholesale")) {
        categories.wholesale.total += 1;
        if (isFulfilled) categories.wholesale.fulfilled += 1;
      } else if (tags.includes("large box")) {
        categories.largeBox.total += 1;
        if (isFulfilled) categories.largeBox.fulfilled += 1;
      } else if (tags.includes("small box")) {
        categories.smallBox.total += 1;
        if (isFulfilled) categories.smallBox.fulfilled += 1;
      } else {
        categories.other.total += 1;
        if (isFulfilled) categories.other.fulfilled += 1;
      }
    }

    const totalOrders = allOrders.length;
    const totalFulfilled = allOrders.filter(o => o.fulfillment_status === "fulfilled").length;

    res.json({ tag, totalOrders, totalFulfilled, categories });
  } catch (err: any) {
    console.error("[Fulfilment] dispatch-progress error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

router.get("/desserts-report", async (req: Request, res: Response) => {
  const { tag } = req.query as { tag?: string };
  if (!tag) {
    res.status(400).json({ error: "tag query param required" });
    return;
  }

  try {
    const [dessertTitles, orders] = await Promise.all([
      getProductsByTag("Desserts"),
      getOrdersByTag(tag),
    ]);

    const productTotals = new Map<string, { quantity: number; orderCount: number }>();

    for (const order of orders) {
      for (const item of order.line_items) {
        if (dessertTitles.has(item.title)) {
          const existing = productTotals.get(item.title) ?? { quantity: 0, orderCount: 0 };
          existing.quantity += item.quantity;
          existing.orderCount += 1;
          productTotals.set(item.title, existing);
        }
      }
    }

    const products = [...productTotals.entries()]
      .map(([title, stats]) => ({ title, ...stats }))
      .sort((a, b) => a.title.localeCompare(b.title));

    const totalQuantity = products.reduce((s, p) => s + p.quantity, 0);

    res.json({ tag, products, totalQuantity, dessertProductCount: dessertTitles.size });
  } catch (err: any) {
    console.error("[Fulfilment] desserts-report error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /service-check?tag=YYYY-MM-DD
// Pre-flight validation: for every unfulfilled order tagged with this
// delivery date, automatically picks the correct APC service code from
// Settings (based on weight/tags/delivery day) and checks with APC's
// PRODUCTION postcode-service endpoint whether the order can be shipped.
//
// Previously this was "weekend-service-check" and took a manual service
// code input, defaulting to "WL16". It now uses validateOrderPostcode
// which reads the configured codes from app_settings and picks per-order.
// It also always hits APC production (never training) so the results
// match what happens when you actually upload consignments.
router.get("/service-check", requireFulfilmentAccess, async (req: Request, res: Response) => {
  const { tag } = req.query as { tag?: string };

  if (!tag) {
    res.status(400).json({ error: "tag query param required (delivery date YYYY-MM-DD)" });
    return;
  }

  try {
    const orders = await getUnfulfilledOrdersByTag(tag);

    const results = await Promise.all(
      orders.map(async (order) => {
        const customerName =
          order.shipping_address?.name ||
          `${order.customer?.first_name ?? ""} ${order.customer?.last_name ?? ""}`.trim() ||
          "Unknown";

        const { available, reason, serviceCode } = await validateOrderPostcode(order, tag);

        return {
          orderName: order.name,
          customerName,
          postcode: order.shipping_address?.zip ?? "",
          available,
          reason,
          serviceCode,
        };
      }),
    );

    const available = results.filter(r => r.available).length;
    const unavailable = results.filter(r => !r.available).length;

    res.json({ tag, results, summary: { available, unavailable, total: results.length } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Fulfilment] service-check error:", msg);
    res.status(502).json({ error: msg });
  }
});

// Keep the old endpoint name alive as an alias so any bookmarked/cached
// URLs don't break. Redirects to /service-check with the same query.
router.get("/weekend-service-check", requireFulfilmentAccess, (req: Request, res: Response) => {
  const qs = new URLSearchParams(req.query as Record<string, string>).toString();
  res.redirect(307, `/api/fulfilment/service-check${qs ? `?${qs}` : ""}`);
});

router.get("/config-status", requireFulfilmentAccess, async (_req: Request, res: Response) => {
  try {
    const [smallWeekday, largeWeekday, smallFriday, largeFriday, testModeSetting, apcMode, bookOnOpenSetting] = await Promise.all([
      getAppSetting("apc_service_code_small_weekday"),
      getAppSetting("apc_service_code_large_weekday"),
      getAppSetting("apc_service_code_small_friday"),
      getAppSetting("apc_service_code_large_friday"),
      getAppSetting("apc_test_mode"),
      getApcMode(),
      getAppSetting("apc_book_on_open"),
    ]);

    const isTestMode = testModeSetting === "true";
    // apcEnabled is kept for backwards compatibility with the existing UI
    // checks and means "some courier integration is active". apcMode is the
    // one to branch on: "full" books labels via the API, "reconcile" verifies
    // a hand-raised consignment by scanning its printed label.
    const apcEnabled = apcMode !== "off";
    res.json({
      apcEnabled,
      apcMode,
      apcCredentialsConfigured: isApcConfigured(),
      serviceCodesConfigured: !!(smallWeekday && largeWeekday && smallFriday && largeFriday),
      // False = batch-book only: opening an order fetches an existing label
      // but never creates a consignment.
      bookOnOpen: bookOnOpenSetting !== "false",
      testMode: isTestMode,
      trainingCredentialsMissing: isTestMode && !trainingCredentialsConfigured(),
      serviceCodes: {
        smallWeekday: smallWeekday ?? "",
        largeWeekday: largeWeekday ?? "",
        smallFriday: smallFriday ?? "",
        largeFriday: largeFriday ?? "",
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Tag audit: find unfulfilled orders with missing or malformed date tags ───

router.get("/tag-audit", requireFulfilmentAccess, async (_req: Request, res: Response) => {
  try {
    // Fetch ALL unfulfilled orders (up to 365 days back to cover everything)
    const orders = await getRecentUnfulfilledOrders(365);

    const problems: Array<{
      orderId: number;
      orderName: string;
      createdAt: string;
      customerName: string | null;
      issue: "no_date_tag" | "bad_format";
      tags: string[];
      badTag?: string;
      suggestedFix?: string;
    }> = [];

    for (const order of orders) {
      const tags = (order.tags ?? "").split(",").map(t => t.trim()).filter(Boolean);
      const dateTags = tags.filter(t => DATE_TAG_RE.test(t));

      if (dateTags.length === 0) {
        // Check if there's a tag that LOOKS like a date but is malformed
        const badDateTag = tags.find(t => {
          // Matches things like "2026/04/13", "13-04-2026", "20260413", "2026-4-13", etc.
          return /\d{4}.*\d{2}.*\d{2}/.test(t) && !DATE_TAG_RE.test(t);
        });

        // Try to parse a corrected date from the bad tag
        let suggestedFix: string | undefined;
        if (badDateTag) {
          // Extract all digit groups
          const digits = badDateTag.match(/\d+/g);
          if (digits && digits.length >= 3) {
            const [a, b, c] = digits.map(Number);
            // Try to figure out format: YYYY-MM-DD, DD-MM-YYYY, YYYY/MM/DD, etc.
            if (a > 1000) {
              // First number is year: YYYY-?-?
              const m = String(b).padStart(2, "0");
              const d = String(c).padStart(2, "0");
              if (b >= 1 && b <= 12 && c >= 1 && c <= 31) suggestedFix = `${a}-${m}-${d}`;
            } else if (c > 1000) {
              // Last number is year: DD-MM-YYYY
              const m = String(b).padStart(2, "0");
              const d = String(a).padStart(2, "0");
              if (b >= 1 && b <= 12 && a >= 1 && a <= 31) suggestedFix = `${c}-${m}-${d}`;
            }
          }
        }

        problems.push({
          orderId: order.id,
          orderName: order.name,
          createdAt: order.created_at,
          customerName: order.customer
            ? `${order.customer.first_name ?? ""} ${order.customer.last_name ?? ""}`.trim() || null
            : null,
          issue: badDateTag ? "bad_format" : "no_date_tag",
          tags,
          badTag: badDateTag ?? undefined,
          suggestedFix,
        });
      }
    }

    // Sort: bad format first, then no tag, then by created date desc
    problems.sort((a, b) => {
      if (a.issue !== b.issue) return a.issue === "bad_format" ? -1 : 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    res.json({
      totalUnfulfilled: orders.length,
      problemCount: problems.length,
      problems,
    });
  } catch (err: any) {
    console.error("[fulfilment/tag-audit]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Fix a bad date tag on a Shopify order
router.post("/tag-fix", requireFulfilmentAccess, async (req: Request, res: Response) => {
  const { orderId, currentTags, badTag, correctTag } = req.body as {
    orderId: number;
    currentTags: string;
    badTag: string;
    correctTag: string;
  };

  if (!orderId || !correctTag || !DATE_TAG_RE.test(correctTag)) {
    res.status(400).json({ error: "orderId and a valid correctTag (YYYY-MM-DD) are required" });
    return;
  }

  try {
    const tagsStr = Array.isArray(currentTags) ? currentTags.join(", ") : (currentTags ?? "");
    const updatedTags = await replaceTagOnOrder(orderId, tagsStr, badTag ?? "", correctTag);
    res.json({ ok: true, updatedTags });
  } catch (err: any) {
    console.error("[fulfilment/tag-fix]", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
