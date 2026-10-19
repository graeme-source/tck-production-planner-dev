/**
 * Chargeback holds — what the packing bench is shown (Graeme, 19 Oct 2026).
 * Objective D.
 *
 * GET /api/fulfilment/chargeback-holds?tag=YYYY-MM-DD
 *   The orders in this despatch day that are held because they have an open
 *   chargeback (or the manual "chargeback" tag). They are filtered out of the
 *   pack list; this is what the "1 order held — open chargeback" banner opens.
 *   Loading it refreshes the dispute list from Shopify when it is more than a
 *   couple of minutes old (read-only).
 *
 * POST /api/fulfilment/chargeback-holds/refresh
 *   Refresh the list from Shopify now (read-only towards Shopify).
 */
import { Router, type Request, type Response } from "express";
import * as z from "zod";
import { requireFulfilmentAccess } from "../lib/fulfilment-access";
import { validate } from "../middleware/validate";
import { getOrdersByTag, shopifyAdminOrderUrl } from "../services/shopify";
import { ensureFreshDisputes, loadOpenDisputes, refreshOpenDisputes, disputeListState } from "../lib/order-disputes-store";
import {
  DISPUTE_ON_DEMAND_MIN_AGE_MS,
  DISPUTE_LIST_STALE_AFTER_MS,
  hasManualChargebackTag,
  isDisputeListStale,
  describeDisputes,
} from "../lib/order-disputes";

const router = Router();

const TagQuery = z.object({ tag: z.string().trim().min(1).max(60) });

router.get("/chargeback-holds", requireFulfilmentAccess, async (req: Request, res: Response) => {
  const parsed = TagQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "tag query param required" });
    return;
  }
  const { tag } = parsed.data;
  try {
    const state = await ensureFreshDisputes(DISPUTE_ON_DEMAND_MIN_AGE_MS);
    const [open, orders] = await Promise.all([loadOpenDisputes(), getOrdersByTag(tag)]);
    const held = orders
      .filter(o => o.fulfillment_status !== "fulfilled" && !o.cancelled_at)
      .filter(o => open.has(o.id) || hasManualChargebackTag(o.tags))
      .map(o => {
        const labels = open.get(o.id)?.statuses ?? [];
        return {
          orderId: o.id,
          orderName: o.name,
          customerName: o.shipping_address?.name
            ?? `${o.customer?.first_name ?? ""} ${o.customer?.last_name ?? ""}`.trim(),
          disputes: labels,
          reason: labels.length > 0 ? `Shopify shows ${describeDisputes(labels)}` : `Tagged "chargeback" in Shopify`,
          adminUrl: shopifyAdminOrderUrl(o.id),
        };
      });
    res.json({
      tag,
      held,
      openDisputesAnywhere: open.size,
      fetchedAt: state.fetchedAt,
      stale: isDisputeListStale(state.fetchedAt, new Date(), DISPUTE_LIST_STALE_AFTER_MS),
      lastError: state.lastError,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[chargeback-holds] error:", msg);
    res.status(502).json({ error: msg });
  }
});

router.post("/chargeback-holds/refresh", requireFulfilmentAccess, validate(z.object({}).passthrough()), async (_req: Request, res: Response) => {
  try {
    const count = await refreshOpenDisputes();
    res.json({ ok: true, count, ...(await disputeListState()) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Couldn't refresh the chargeback list from Shopify: ${msg}` });
  }
});

export default router;
