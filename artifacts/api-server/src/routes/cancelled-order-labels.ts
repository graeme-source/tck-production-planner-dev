/**
 * Labels booked for orders that were cancelled in Shopify (Graeme, 21 Oct
 * 2026). Objective F — despatch accuracy.
 *
 * GET /api/fulfilment/cancelled-order-labels?tag=YYYY-MM-DD
 *   Live APC consignments for this despatch day (not cancelled in our
 *   ledger) whose Shopify order is now cancelled. #137271 was cancelled on
 *   16 Oct, tagged for dispatch and booked on 21 Oct; a packer spotted it by
 *   chance. Cancelled orders now never get tagged or booked, but an order
 *   cancelled AFTER its label was booked still has a label APC may collect
 *   against — the packing screen shows it as "Cancelled in Shopify — cancel
 *   this label".
 *
 * Read-only. The label is NOT cancelled automatically: an APC write needs a
 * person, so the bench uses the existing POST /shipments/:waybill/cancel.
 */
import { Router, type Request, type Response } from "express";
import * as z from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireFulfilmentAccess } from "../lib/fulfilment-access";
import { getOrdersByTagIncludingCancelled, shopifyAdminOrderUrl } from "../services/shopify";
import { cancelledOrderLabels } from "../lib/dispatch-tag";

const router = Router();

const TagQuery = z.object({ tag: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/) });

router.get("/cancelled-order-labels", requireFulfilmentAccess, async (req: Request, res: Response) => {
  const parsed = TagQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "tag query param required (YYYY-MM-DD)" });
    return;
  }
  const { tag } = parsed.data;
  try {
    const rows = await db.execute<{ waybill: string; shopify_order_id: string; shopify_order_name: string }>(sql`
      SELECT waybill, shopify_order_id, shopify_order_name
      FROM apc_consignments
      WHERE dispatch_tag = ${tag} AND cancelled_at IS NULL
      ORDER BY created_at
    `);
    if (rows.rows.length === 0) {
      res.json({ tag, labels: [] });
      return;
    }
    const orders = await getOrdersByTagIncludingCancelled(tag);
    const labels = cancelledOrderLabels(
      rows.rows.map(r => ({ waybill: r.waybill, orderId: Number(r.shopify_order_id), orderName: r.shopify_order_name })),
      orders,
    ).map(l => ({ ...l, adminUrl: shopifyAdminOrderUrl(l.orderId) }));
    res.json({ tag, labels });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cancelled-order-labels] error:", msg);
    res.status(502).json({ error: msg });
  }
});

export default router;
