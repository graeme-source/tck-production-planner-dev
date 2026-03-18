import { Router } from "express";
import { getOrdersByTag, getProducts, countProductsByTag } from "../services/shopify";

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

export default router;
