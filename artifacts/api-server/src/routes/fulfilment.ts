import { Router, type Request, type Response } from "express";
import { db, skuLocationsTable, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import * as z from "zod";
import { getUnfulfilledOrdersByTag, getOrdersByTag, fulfillOrder, type ShopifyOrder } from "../services/shopify";
import { createShipment, isConfigured as isApcConfigured } from "../services/apc";

const router = Router();

async function getAppSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, key));
  return row?.value ?? null;
}

function pickServiceCode(
  order: ShopifyOrder,
  codes: { smallWeekday: string; largeWeekday: string; smallFriday: string; largeFriday: string },
  weightThresholdG: number,
): string {
  const tags = order.tags.split(",").map(t => t.trim().toLowerCase());
  const weightG = order.total_weight ?? 0;

  const isLargeBox = tags.includes("large-box") || weightG >= weightThresholdG;
  const isFriday = tags.includes("friday-delivery");

  if (isLargeBox && isFriday) return codes.largeFriday;
  if (isLargeBox) return codes.largeWeekday;
  if (isFriday) return codes.smallFriday;
  return codes.smallWeekday;
}

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
});

router.post("/shipments", async (req: Request, res: Response) => {
  const parsed = CreateShipmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "orderId (number) and tag (string) are required" });
    return;
  }

  if (!isApcConfigured()) {
    res.status(503).json({ error: "APC credentials not configured. Please set APC_USERNAME, APC_PASSWORD and APC_ACCOUNT_NUMBER." });
    return;
  }

  const { orderId, tag } = parsed.data;

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

router.post("/orders/:id/complete", async (req: Request, res: Response) => {
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

router.get("/sku-locations", async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(skuLocationsTable).orderBy(skuLocationsTable.sku);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const UpsertLocationBody = z.object({
  zone: z.enum(["fridge", "freezer", "ambient"]),
  locationLabel: z.string().min(1, "Location label is required"),
});

router.put("/sku-locations/:sku", async (req: Request, res: Response) => {
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

router.delete("/sku-locations/:sku", async (req: Request, res: Response) => {
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
