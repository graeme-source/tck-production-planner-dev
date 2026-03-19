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
    const today = new Date();
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      return d;
    });

    const results = await Promise.all(
      days.map(async (d) => {
        const tag = toDateTag(d);
        const orders = await getOrdersByTag(tag);
        return {
          date: tag,
          day: DAY_NAMES[d.getDay()],
          orderCount: orders.length,
        };
      })
    );

    res.json(results);
  } catch (err: any) {
    console.error("[Shopify] weekly-orders error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

export default router;
