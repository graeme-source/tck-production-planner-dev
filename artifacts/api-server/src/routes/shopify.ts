import { Router, type Request, type Response, type NextFunction } from "express";
import { getOrdersByTag, getProducts, countProductsByTag, getOrdersByDateRange, type ShopifyOrder } from "../services/shopify";
import { db, recipesTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const EXCLUDED_FINANCIAL = new Set(["refunded", "voided"]);

function isCountableOrder(o: ShopifyOrder): boolean {
  if (o.cancelled_at) return false;
  if (EXCLUDED_FINANCIAL.has(o.financial_status)) return false;
  return true;
}

function getRefundTotal(o: ShopifyOrder): number {
  if (!o.refunds || o.refunds.length === 0) return 0;
  return o.refunds.reduce((sum, r) => {
    if (!r.transactions) return sum;
    return sum + r.transactions
      .filter(t => t.kind === "refund" && t.status === "success")
      .reduce((s, t) => s + parseFloat(t.amount || "0"), 0);
  }, 0);
}

function getNetRevenue(o: ShopifyOrder): number {
  const subtotal = parseFloat(o.subtotal_price || "0");
  const refunds = getRefundTotal(o);
  return subtotal - refunds;
}

const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";

async function requireFounder(req: Request, res: Response, next: NextFunction) {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    const [user] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (user?.email === FOUNDER_EMAIL) {
      next();
      return;
    }
    res.status(403).json({ error: "Access denied" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[requireFounder] DB lookup failed:", msg);
    res.status(500).json({ error: "Internal server error" });
  }
}

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
    const [[counts, orders], specialRows] = await Promise.all([
      Promise.all([countProductsByTag(tag), getOrdersByTag(tag)]),
      db.select({ id: recipesTable.id, name: recipesTable.name })
        .from(recipesTable)
        .where(eq(recipesTable.isCurrentSpecial, true))
        .limit(1),
    ]);

    const specialRecipe = specialRows[0] ?? null;
    const SPECIAL_KEY = "calzone club special";

    let products = counts;
    if (specialRecipe) {
      const specialEntry = counts.find(p => p.productTitle.toLowerCase().trim() === SPECIAL_KEY);
      if (specialEntry) {
        const specialQty = specialEntry.totalQuantity;
        const withoutSpecialEntry = products.filter(p => p.productTitle.toLowerCase().trim() !== SPECIAL_KEY);
        const existingIdx = withoutSpecialEntry.findIndex(p =>
          p.productTitle.toLowerCase().includes(specialRecipe.name.toLowerCase()) ||
          specialRecipe.name.toLowerCase().includes(p.productTitle.toLowerCase())
        );
        if (existingIdx !== -1) {
          products = withoutSpecialEntry.map((p, i) => i === existingIdx
            ? {
                ...p,
                totalQuantity: p.totalQuantity + specialQty,
                orderCount: p.orderCount + specialEntry.orderCount,
                specialCount: specialQty,
                variants: [...p.variants, ...specialEntry.variants],
              }
            : p
          );
        } else {
          products = [
            ...withoutSpecialEntry,
            { ...specialEntry, productTitle: specialRecipe.name, specialCount: specialQty },
          ];
        }
      }
    }

    res.json({
      tag,
      orderCount: orders.length,
      products,
      currentSpecialRecipeName: specialRecipe?.name ?? null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Shopify] order-summary error:", msg);
    res.status(502).json({ error: msg });
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

// ── Founder View: Sales Summary ───────────────────────────────────────────────
// GET /api/shopify/sales-summary?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns aggregated revenue stats for the period + today's revenue.
router.get("/sales-summary", requireFounder, async (req, res) => {
  const { from, to } = req.query as { from?: string; to?: string };
  if (!from || !to) {
    res.status(400).json({ error: "from and to query params required (YYYY-MM-DD)" });
    return;
  }
  try {
    const todayStr = toDateTag(new Date());
    const [periodOrders, todayOrders] = await Promise.all([
      getOrdersByDateRange(from, to),
      todayStr >= from && todayStr <= to
        ? Promise.resolve(null)
        : getOrdersByDateRange(todayStr, todayStr),
    ]);

    // Deduplicate by order ID in case pagination returns duplicates
    const deduped = [...new Map(periodOrders.map(o => [o.id, o])).values()];
    const validPeriod = deduped.filter(isCountableOrder);

    const todayOrdersFinal = todayOrders
      ? [...new Map(todayOrders.map(o => [o.id, o])).values()].filter(isCountableOrder)
      : validPeriod.filter(o => o.created_at.slice(0, 10) === todayStr);

    const totalRevenue = validPeriod.reduce((sum, o) => sum + getNetRevenue(o), 0);
    const todayRevenue = todayOrdersFinal.reduce((sum, o) => sum + getNetRevenue(o), 0);

    // ── Diagnostics ──
    const grossSubtotal = validPeriod.reduce((s, o) => s + parseFloat(o.subtotal_price || "0"), 0);
    const totalRefundAmt = validPeriod.reduce((s, o) => s + getRefundTotal(o), 0);
    const partiallyRefundedCount = validPeriod.filter(o => o.financial_status === "partially_refunded").length;
    console.log(`[sales-summary] ${from}→${to}: ${validPeriod.length} orders, subtotal £${grossSubtotal.toFixed(2)}, refunds -£${totalRefundAmt.toFixed(2)}, net £${totalRevenue.toFixed(2)}, partially_refunded: ${partiallyRefundedCount}`);

    // Calculate days elapsed in the period (from → min(to, today))
    const fromDate = new Date(from + "T00:00:00Z");
    const toDate = new Date(to + "T23:59:59Z");
    const nowDate = new Date();
    const effectiveTo = toDate < nowDate ? toDate : nowDate;
    const msPerDay = 24 * 60 * 60 * 1000;
    const dayCount = Math.max(1, Math.ceil((effectiveTo.getTime() - fromDate.getTime()) / msPerDay));

    const averageDailyRevenue = totalRevenue / dayCount;

    // Days in the current calendar month
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const estimatedMonthlyRevenue = averageDailyRevenue * daysInMonth;

    res.json({
      from,
      to,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      orderCount: validPeriod.length,
      dayCount,
      averageDailyRevenue: Math.round(averageDailyRevenue * 100) / 100,
      estimatedMonthlyRevenue: Math.round(estimatedMonthlyRevenue * 100) / 100,
      todayRevenue: Math.round(todayRevenue * 100) / 100,
      todayOrderCount: todayOrdersFinal.length,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Shopify] sales-summary error:", msg);
    res.status(502).json({ error: msg });
  }
});

// ── Founder View: Orders by Customer Type ─────────────────────────────────────
// GET /api/shopify/orders-by-type?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns counts + order lists grouped by the four customer-type tags.
const CUSTOMER_TYPE_TAGS = [
  "new-customer",
  "Subscription Recurring Order",
  "Subscription New Order",
  "wholesale",
] as const;

router.get("/orders-by-type", requireFounder, async (req, res) => {
  const { from, to } = req.query as { from?: string; to?: string };
  if (!from || !to) {
    res.status(400).json({ error: "from and to query params required (YYYY-MM-DD)" });
    return;
  }
  try {
    const allOrders = (await getOrdersByDateRange(from, to)).filter(isCountableOrder);

    const groups = CUSTOMER_TYPE_TAGS.map(tag => {
      const tagLower = tag.toLowerCase();
      const matchingOrders = allOrders.filter(o => {
        const tags = o.tags.split(",").map(t => t.trim().toLowerCase());
        return tags.includes(tagLower);
      });
      return {
        tag,
        count: matchingOrders.length,
        orders: matchingOrders.map(o => ({
          id: o.id,
          orderNumber: o.name,
          customerName: o.customer
            ? `${o.customer.first_name} ${o.customer.last_name}`.trim()
            : "Guest",
          date: o.created_at.slice(0, 10),
          total: getNetRevenue(o),
          fulfillmentStatus: o.fulfillment_status ?? "unfulfilled",
        })),
      };
    });

    res.json({ from, to, groups });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Shopify] orders-by-type error:", msg);
    res.status(502).json({ error: msg });
  }
});

// ── Founder View: Tag Summary (for custom panels) ─────────────────────────────
// GET /api/shopify/tag-summary?tag=...&from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns order count + total value for any single Shopify tag.
router.get("/tag-summary", requireFounder, async (req, res) => {
  const { tag, from, to } = req.query as { tag?: string; from?: string; to?: string };
  if (!tag || !from || !to) {
    res.status(400).json({ error: "tag, from, and to are required" });
    return;
  }
  try {
    const allOrders = (await getOrdersByDateRange(from, to)).filter(isCountableOrder);
    const tagLower = tag.toLowerCase();
    const matching = allOrders.filter(o => {
      const tags = o.tags.split(",").map(t => t.trim().toLowerCase());
      return tags.includes(tagLower);
    });
    const totalValue = matching.reduce((s, o) => s + getNetRevenue(o), 0);
    res.json({ tag, from, to, count: matching.length, totalValue });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Shopify] tag-summary error:", msg);
    res.status(502).json({ error: msg });
  }
});

// ── Recipe → Shopify variant mapping — bulk read (used by stations) ───────────

// GET /recipe-mappings — all mappings with recipe names (per-recipe CRUD is at /api/recipes/:id/shopify-mapping)
router.get("/recipe-mappings", async (_req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT rsm.id, rsm.recipe_id, rsm.shopify_variant_id, rsm.shopify_product_title,
             rsm.shopify_variant_title, rsm.created_at, r.name AS recipe_name
      FROM recipe_shopify_mappings rsm
      JOIN recipes r ON rsm.recipe_id = r.id
      ORDER BY r.name
    `);
    res.json(rows.rows);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
