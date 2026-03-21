import { Router } from "express";
import { getOrdersByTag, getProducts, countProductsByTag } from "../services/shopify";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toDateTag(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const router = Router();

router.get("/products", async (req, res) => {
  try {
    const products = await getProducts();
    res.json(products);
  } catch (err: any) {
    console.error("[Shopify] products error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

router.get("/orders", async (req, res) => {
  const { tag } = req.query as { tag?: string };
  if (!tag) {
    res.status(400).json({ error: "tag query param required (e.g. ?tag=2026-03-20)" });
    return;
  }
  try {
    const orders = await getOrdersByTag(tag);
    res.json(orders);
  } catch (err: any) {
    console.error("[Shopify] orders error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

router.get("/order-summary", async (req, res) => {
  const { tag } = req.query as { tag?: string };
  if (!tag) {
    res.status(400).json({ error: "tag query param required (e.g. ?tag=2026-03-20)" });
    return;
  }
  try {
    const [counts, orders] = await Promise.all([
      countProductsByTag(tag),
      getOrdersByTag(tag),
    ]);
    res.json({
      tag,
      orderCount: orders.length,
      products: counts,
    });
  } catch (err: any) {
    console.error("[Shopify] order-summary error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

router.get("/weekly-orders", async (req, res) => {
  try {
    const weekStartParam = req.query.weekStart as string | undefined;
    let monday: Date;

    if (weekStartParam) {
      monday = new Date(weekStartParam + "T00:00:00");
    } else {
      const today = new Date();
      const dayOfWeek = today.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      monday = new Date(today);
      monday.setDate(today.getDate() + diff);
    }
    monday.setHours(0, 0, 0, 0);

    const results = await Promise.all(
      Array.from({ length: 7 }, async (_, i) => {
        const dispatchDay = new Date(monday);
        dispatchDay.setDate(monday.getDate() + i);

        const deliveryDay = new Date(monday);
        deliveryDay.setDate(monday.getDate() + i + 1);

        const tag = toDateTag(deliveryDay);
        const orders = await getOrdersByTag(tag);

        const fulfilledCount = orders.filter(o => o.fulfillment_status === "fulfilled").length;
        return {
          date: toDateTag(dispatchDay),
          deliveryDate: tag,
          day: DAY_NAMES[dispatchDay.getDay()],
          orderCount: orders.length,
          fulfilledCount,
          unfulfilledCount: orders.length - fulfilledCount,
        };
      })
    );

    res.json({ weekStart: toDateTag(monday), days: results });
  } catch (err: any) {
    console.error("[Shopify] weekly-orders error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

export default router;
