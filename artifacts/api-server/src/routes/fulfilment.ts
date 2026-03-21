import { Router, type Request, type Response, type NextFunction } from "express";
import { db, skuLocationsTable, appSettingsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import * as z from "zod";
import { getUnfulfilledOrdersByTag, getOrdersByTag, getRecentUnfulfilledOrders, fulfillOrder, type ShopifyOrder } from "../services/shopify";
import { createShipment, isConfigured as isApcConfigured } from "../services/apc";

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
  const hasLargeTag = tags.includes("large-box");
  const hasSmallTag = tags.includes("small-box");
  const isLargeBox = hasLargeTag || (!hasSmallTag && weightG >= weightThresholdG);

  // Friday if tag present OR the actual dispatch date falls on a Friday (day=5)
  const refDate = dispatchDate ?? new Date();
  const isFriday = tags.includes("friday-delivery") || refDate.getDay() === 5;

  if (isLargeBox && isFriday) return codes.largeFriday;
  if (isLargeBox) return codes.largeWeekday;
  if (isFriday) return codes.smallFriday;
  return codes.smallWeekday;
}

// GET /dispatch-tags — returns all active dispatch dates with unfulfilled order counts/weights.
// Used by the fulfilment landing page to show operators what needs to be done each day.
const DATE_TAG_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get("/dispatch-tags", async (_req: Request, res: Response) => {
  try {
    const orders = await getRecentUnfulfilledOrders(30);

    const groups = new Map<string, { orderCount: number; totalItems: number; totalWeightG: number }>();

    for (const order of orders) {
      const tags = order.tags.split(",").map(t => t.trim());
      const dateTag = tags.find(t => DATE_TAG_RE.test(t));
      if (!dateTag) continue; // skip orders without a dispatch date tag

      const existing = groups.get(dateTag) ?? { orderCount: 0, totalItems: 0, totalWeightG: 0 };
      existing.orderCount += 1;
      existing.totalItems += order.line_items.reduce((s, i) => s + i.quantity, 0);
      existing.totalWeightG += order.total_weight ?? 0;
      groups.set(dateTag, existing);
    }

    const result = [...groups.entries()]
      .map(([tag, stats]) => ({ tag, ...stats }))
      .sort((a, b) => a.tag.localeCompare(b.tag)); // ascending by date

    res.json(result);
  } catch (err: any) {
    console.error("[Fulfilment] dispatch-tags error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

router.get("/orders", async (req: Request, res: Response) => {
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
    const [smallWeekday, largeWeekday, smallFriday, largeFriday, weightThreshStr] = await Promise.all([
      getAppSetting("apc_service_code_small_weekday"),
      getAppSetting("apc_service_code_large_weekday"),
      getAppSetting("apc_service_code_small_friday"),
      getAppSetting("apc_service_code_large_friday"),
      getAppSetting("apc_weight_threshold_grams"),
    ]);

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

    const weightKg = (order.total_weight ?? 500) / 1000;
    const customerName = order.shipping_address.name ||
      `${order.customer?.first_name ?? ""} ${order.customer?.last_name ?? ""}`.trim();

    const result = await createShipment({
      serviceCode,
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
    });

    res.json({
      consignmentNumber: result.consignmentNumber,
      labelPdfBase64: result.labelPdfBase64,
      trackingUrl: result.trackingUrl,
      serviceCode,
      orderId,
      orderName: order.name,
    });
  } catch (err: any) {
    console.error("[Fulfilment] createShipment error:", err.message);
    const status = err.message?.includes("not configured") ? 503 :
      err.message?.includes("not found") ? 404 : 502;
    res.status(status).json({ error: err.message });
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

router.get("/config-status", async (_req: Request, res: Response) => {
  try {
    const [smallWeekday, largeWeekday, smallFriday, largeFriday] = await Promise.all([
      getAppSetting("apc_service_code_small_weekday"),
      getAppSetting("apc_service_code_large_weekday"),
      getAppSetting("apc_service_code_small_friday"),
      getAppSetting("apc_service_code_large_friday"),
    ]);

    res.json({
      apcCredentialsConfigured: isApcConfigured(),
      serviceCodesConfigured: !!(smallWeekday && largeWeekday && smallFriday && largeFriday),
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

export default router;
