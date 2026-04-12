import { Router, type Request, type Response, type NextFunction } from "express";
import { db, skuLocationsTable, appSettingsTable, usersTable, shopifyFulfilmentTrackingTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import * as z from "zod";
import { getUnfulfilledOrdersByTag, getOrdersByTag, getRecentUnfulfilledOrders, fulfillOrder, getProductsByTag, findOrderByName, addTagToOrder, getOrderById, type ShopifyOrder } from "../services/shopify";
import { createShipment, addParcel, cancelShipment, fetchLabel, isConfigured as isApcConfigured, trainingCredentialsConfigured, APC_TRAINING_BASE, checkPostcodeService } from "../services/apc";
import { decrementFridgeForShopifyOrder } from "../lib/inventory-sync";
import { sql } from "drizzle-orm";

const router = Router();

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

// Managers and admins can perform operational fulfilment actions (create shipments, complete orders).
// Viewers cannot — they are read-only users.
async function requireManagerOrAdmin(req: Request, res: Response, next: NextFunction) {
  const role = await resolveRole(req);
  if (role === "admin" || role === "manager") { next(); return; }
  res.status(403).json({ error: "Manager or admin access required to perform fulfilment operations" });
}

async function getAppSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, key));
  return row?.value ?? null;
}

function pickServiceCode(
  order: ShopifyOrder,
  codes: { smallWeekday: string; largeWeekday: string; smallFriday: string; largeFriday: string },
  weightThresholdG: number,
  dispatchDate?: Date,
): string {
  const tags = order.tags.split(",").map(t => t.trim().toLowerCase());
  const weightG = order.total_weight ?? 0;

  // Use explicit box-size tags when present. Weight is a fallback only when
  // neither tag is found (e.g. no Shopify tagging rule has run yet).
  const hasLargeTag = tags.includes("large box") || tags.includes("wholesale");
  const hasSmallTag = tags.includes("small box");
  const isLargeBox = hasLargeTag || (!hasSmallTag && weightG >= weightThresholdG);

  // Friday/weekend: use the Friday service codes for deliveries on
  // Friday (5), Saturday (6), or Sunday (0). The settings label these as
  // "Friday/weekend" codes — previously only day 5 matched, which meant
  // Saturday deliveries incorrectly used weekday codes.
  const refDate = dispatchDate ?? new Date();
  const dow = refDate.getDay();
  const isFriday = tags.includes("friday-delivery") || dow === 5 || dow === 6 || dow === 0;

  if (isLargeBox && isFriday) return codes.largeFriday;
  if (isLargeBox) return codes.largeWeekday;
  if (isFriday) return codes.smallFriday;
  return codes.smallWeekday;
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
    return { available: false, reason: `Check failed: ${msg}`, serviceCode };
  }
}

// GET /dispatch-tags — returns all active dispatch dates with unfulfilled order counts/weights.
// Used by the fulfilment landing page to show operators what needs to be done each day.
const DATE_TAG_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get("/dispatch-tags", requireManagerOrAdmin, async (_req: Request, res: Response) => {
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
        const issueRows = await db.execute(sql`
          SELECT dispatch_tag, COUNT(*)::int as issue_count FROM (
            SELECT DISTINCT ON (shopify_order_id, dispatch_tag) shopify_order_id, dispatch_tag, available
            FROM postcode_validations
            WHERE dispatch_tag = ANY(${dateTags})
            ORDER BY shopify_order_id, dispatch_tag, checked_at DESC
          ) latest WHERE available = false
          GROUP BY dispatch_tag
        `);
        interface TagIssueRow { dispatch_tag: string; issue_count: number }
        for (const row of issueRows.rows) {
          const r: TagIssueRow = row as TagIssueRow;
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

router.get("/orders", requireManagerOrAdmin, async (req: Request, res: Response) => {
  const { tag, includeAll } = req.query as { tag?: string; includeAll?: string };

  if (!tag) {
    res.status(400).json({ error: "tag query param required" });
    return;
  }

  try {
    const orders = includeAll === "1"
      ? await getOrdersByTag(tag)
      : await getUnfulfilledOrdersByTag(tag);

    const allLocations = await db.select().from(skuLocationsTable);
    const locationBySku = new Map(allLocations.map(l => [l.sku, l]));

    const enriched = orders.map(order => {
      const lineItems = order.line_items.map(item => ({
        ...item,
        location: item.sku ? (locationBySku.get(item.sku) ?? null) : null,
      }));
      return { ...order, line_items: lineItems };
    });

    res.json(enriched);
  } catch (err: any) {
    console.error("[Fulfilment] orders error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

const CreateShipmentBody = z.object({
  orderId: z.number(),
  tag: z.string(),
  dispatchDate: z.string().optional(), // ISO date string e.g. "2025-01-17"
});

router.post("/shipments", requireManagerOrAdmin, async (req: Request, res: Response) => {
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

    const existingValidation = await db.execute(sql`
      SELECT available, reason, service_code FROM postcode_validations
      WHERE shopify_order_id = ${orderId} AND dispatch_tag = ${tag} AND service_code = ${serviceCode} AND available = false
      ORDER BY checked_at DESC LIMIT 1
    `);
    interface ValidationRow { available: boolean; reason: string | null; service_code: string }
    if (existingValidation.rows.length > 0) {
      const v: ValidationRow = existingValidation.rows[0] as ValidationRow;
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
      reference: order.name,
      specialInstructions,
      ...(apiBase ? { apiBase } : {}),
    });

    res.json({
      consignmentNumber: result.consignmentNumber,
      labelPdfBase64: result.labelPdfBase64,
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

async function getTestModeApiBase(): Promise<string | undefined> {
  const testModeSetting = await getAppSetting("apc_test_mode");
  return testModeSetting === "true" ? APC_TRAINING_BASE : undefined;
}

router.post("/shipments/:waybill/add-parcel", requireManagerOrAdmin, async (req: Request, res: Response) => {
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

router.post("/shipments/:waybill/reprint-label", requireManagerOrAdmin, async (req: Request, res: Response) => {
  const { waybill } = req.params;

  if (!isApcConfigured()) {
    res.status(503).json({ error: "APC credentials not configured." });
    return;
  }

  try {
    const apiBase = await getTestModeApiBase();
    const base = apiBase ?? (process.env.APC_API_BASE ?? "https://apc.hypaship.com/api/3.0");

    const labelPdfs = await fetchLabel(waybill, base);

    res.json({ labelPdfs });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Fulfilment] reprint-label error for ${waybill}:`, msg);
    res.status(502).json({ error: msg });
  }
});

// Cancel is called BEFORE "Confirm & Complete" — the order has not been fulfilled
// on Shopify yet, so there is no Shopify fulfillment to undo. The only server-side
// state to reset is the APC consignment itself. The frontend removes the local
// shipment reference and returns the operator to the order list, where the order
// remains in the unfulfilled queue ready to be re-packed.
router.post("/shipments/:waybill/cancel", requireManagerOrAdmin, async (req: Request, res: Response) => {
  const { waybill } = req.params;

  if (!isApcConfigured()) {
    res.status(503).json({ error: "APC credentials not configured." });
    return;
  }

  try {
    const apiBase = await getTestModeApiBase();

    await cancelShipment(waybill, apiBase);

    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Fulfilment] cancel error for ${waybill}:`, msg);
    res.status(502).json({ error: msg });
  }
});

// POST /tag-dispatch — find an order by name and add the "dispatch" tag.
// Used by the Dispatch Tagging page to gate which orders appear in the packing queue.
router.post("/tag-dispatch", requireManagerOrAdmin, async (req: Request, res: Response) => {
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
    if (isApcConfigured() && dateTag) {
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

router.post("/tag-dispatch-bulk", requireManagerOrAdmin, async (req: Request, res: Response) => {
  const { tag, category } = req.body as { tag?: string; category?: string };
  if (!tag || !category) {
    res.status(400).json({ error: "tag and category are required" });
    return;
  }
  const validCategories = ["small box", "large box", "wholesale", "other", "all"];
  if (!validCategories.includes(category)) {
    res.status(400).json({ error: `Invalid category. Must be one of: ${validCategories.join(", ")}` });
    return;
  }

  try {
    const orders = await getOrdersByTag(tag);
    const unfulfilled = orders.filter(o => o.fulfillment_status !== "fulfilled");
    const untagged = unfulfilled.filter(o =>
      !o.tags.split(",").map(t => t.trim()).includes("dispatch")
    );

    const toTag = category === "all"
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
    for (const order of toTag) {
      await addTagToOrder(order.id, order.tags, "dispatch");
      tagged++;

      if (isApcConfigured()) {
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

router.get("/postcode-validations", requireManagerOrAdmin, async (req: Request, res: Response) => {
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

router.post("/postcode-recheck", requireManagerOrAdmin, async (req: Request, res: Response) => {
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

router.post("/postcode-validate-tag", requireManagerOrAdmin, async (req: Request, res: Response) => {
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

const CompleteOrderBody = z.object({
  consignmentNumber: z.string().min(1),
  trackingUrl: z.string().optional(),
});

router.post("/orders/:id/complete", requireManagerOrAdmin, async (req: Request, res: Response) => {
  const orderId = Number(req.params.id);
  if (isNaN(orderId)) {
    res.status(400).json({ error: "Invalid order ID" });
    return;
  }

  const parsed = CompleteOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "consignmentNumber is required" });
    return;
  }

  const { consignmentNumber, trackingUrl } = parsed.data;

  // Factory-number accounting loop: decrement production_fridge stock
  // for the recipes in this order, BEFORE we call Shopify's fulfil
  // endpoint. If this step fails we log and keep going — the dispatch
  // must not be blocked by an inventory bug. The tracking table
  // dedupes against the safety-net poller so no double-decrement.
  try {
    const [existing] = await db
      .select({ shopifyOrderId: shopifyFulfilmentTrackingTable.shopifyOrderId })
      .from(shopifyFulfilmentTrackingTable)
      .where(eq(shopifyFulfilmentTrackingTable.shopifyOrderId, orderId));
    if (!existing) {
      const order = await getOrderById(orderId);
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
      }
    }
  } catch (err) {
    console.error(`[Fulfilment] inventory decrement failed for order ${orderId}:`, err);
  }

  try {
    await fulfillOrder(orderId, consignmentNumber, "APC Overnight", trackingUrl);
    res.json({ ok: true, orderId, consignmentNumber });
  } catch (err: any) {
    console.error("[Fulfilment] completeOrder error:", err.message);
    res.status(502).json({ error: err.message });
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

router.put("/sku-locations/:sku", requireAdmin, async (req: Request, res: Response) => {
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

router.delete("/sku-locations/:sku", requireAdmin, async (req: Request, res: Response) => {
  const sku = decodeURIComponent(req.params.sku);
  try {
    await db.delete(skuLocationsTable).where(eq(skuLocationsTable.sku, sku));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/dispatch-progress", requireManagerOrAdmin, async (req: Request, res: Response) => {
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

router.get("/desserts-report", requireManagerOrAdmin, async (req: Request, res: Response) => {
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
router.get("/service-check", requireManagerOrAdmin, async (req: Request, res: Response) => {
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
router.get("/weekend-service-check", requireManagerOrAdmin, (req: Request, res: Response) => {
  const qs = new URLSearchParams(req.query as Record<string, string>).toString();
  res.redirect(307, `/api/fulfilment/service-check${qs ? `?${qs}` : ""}`);
});

router.get("/config-status", requireManagerOrAdmin, async (_req: Request, res: Response) => {
  try {
    const [smallWeekday, largeWeekday, smallFriday, largeFriday, testModeSetting] = await Promise.all([
      getAppSetting("apc_service_code_small_weekday"),
      getAppSetting("apc_service_code_large_weekday"),
      getAppSetting("apc_service_code_small_friday"),
      getAppSetting("apc_service_code_large_friday"),
      getAppSetting("apc_test_mode"),
    ]);

    const isTestMode = testModeSetting === "true";
    res.json({
      apcCredentialsConfigured: isApcConfigured(),
      serviceCodesConfigured: !!(smallWeekday && largeWeekday && smallFriday && largeFriday),
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

const DATE_TAG_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get("/tag-audit", requireManagerOrAdmin, async (_req: Request, res: Response) => {
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

export default router;
