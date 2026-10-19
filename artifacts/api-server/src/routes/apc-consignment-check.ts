/**
 * APC consignment check + old-booking decisions (incident #136845, Graeme
 * 19 Oct 2026). Mounted under /api/fulfilment.
 *
 *   GET  /apc-consignment-check                 the report (no APC call)
 *   POST /apc-consignment-check/run             re-read APC tracking, then report
 *   GET  /orders/:orderId/old-apc-bookings      an order's retired bookings, with
 *                                               APC's live status (read-only)
 *   POST /consignments/:waybill/apc-cancel      cancel an OLD booking at APC —
 *                                               only on a manager's confirm
 *   POST /consignments/:waybill/apc-cancel-decision
 *                                               "I'll cancel it in Hypaship" /
 *                                               "keep it" — recorded, nothing sent
 *
 * All behind the "Book APC labels" ability (manager, or a grant), as the
 * other courier actions are. Nothing here is sent to APC except the cancel,
 * and that only for a booking the app has already retired (superseded), that
 * was never sent to the customer, after an explicit confirm.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { validate } from "../middleware/validate";
import { requireFeature } from "../lib/feature-access";
import { isStaging } from "../lib/app-env";
import { runConsignmentCheck, lastRun } from "../lib/apc-consignment-check";
import { liveStatusOf, markCancelledInApc } from "../lib/apc-consignment-ledger";
import { collectionDateOf } from "../lib/apc-consignment-reuse";
import { cancelShipment, isConfigured as isApcConfigured, APC_TRAINING_BASE } from "../services/apc";
import { shopifyAdminOrderBase } from "../services/shopify";

const router: IRouter = Router();
const requireCourier = requireFeature("ability.book_apc_labels");

async function userName(req: Request): Promise<string> {
  if (!req.session.userId) return "unknown";
  const r = await db.execute<{ name: string }>(sql`SELECT name FROM app_users WHERE id = ${req.session.userId}`);
  return r.rows[0]?.name ?? `user ${req.session.userId}`;
}

async function apcBase(): Promise<string | undefined> {
  const r = await db.execute<{ value: string | null }>(sql`SELECT value FROM app_settings WHERE key = 'apc_test_mode'`);
  return r.rows[0]?.value === "true" ? APC_TRAINING_BASE : undefined;
}

function daysParam(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 120) : 45;
}

router.get("/apc-consignment-check", requireCourier, async (req: Request, res: Response) => {
  try {
    const report = await runConsignmentCheck({ days: daysParam(req.query.days), readApc: false, notify: false });
    res.json({ ...report, lastRun: await lastRun(), adminOrderBase: shopifyAdminOrderBase() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[apc-check] report failed:", msg);
    res.status(500).json({ error: msg });
  }
});

const RunBody = z.object({ days: z.number().int().min(1).max(120).optional() });

router.post("/apc-consignment-check/run", requireCourier, validate(RunBody), async (req: Request, res: Response) => {
  const { days } = req.body as z.infer<typeof RunBody>;
  try {
    const report = await runConsignmentCheck({ days, readApc: true, notify: true });
    res.json({ ...report, lastRun: await lastRun(), adminOrderBase: shopifyAdminOrderBase() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[apc-check] run failed:", msg);
    res.status(500).json({ error: msg });
  }
});

type OldRow = {
  waybill: string;
  collection_date: string | null;
  created_at: Date | string | null;
  superseded_reason: string | null;
  apc_status: string | null;
};

/** An order's retired bookings still waiting on a decision, each with what
 *  APC says now. One that APC already shows as dead is marked cancelled and
 *  dropped — there is nothing to decide. */
router.get("/orders/:orderId/old-apc-bookings", requireCourier, async (req: Request, res: Response) => {
  const orderId = Number(req.params.orderId);
  if (!Number.isFinite(orderId)) { res.status(400).json({ error: "Invalid orderId" }); return; }
  try {
    const rows = await db.execute<OldRow>(sql`
      SELECT waybill, collection_date::text AS collection_date, created_at, superseded_reason, apc_status
      FROM apc_consignments
      WHERE shopify_order_id = ${orderId}
        AND superseded_at IS NOT NULL AND cancelled_at IS NULL
        AND apc_cancel_decision IS NULL AND pushed_to_shopify_at IS NULL
      ORDER BY created_at DESC
    `);
    const base = await apcBase();
    const out: Array<{ waybill: string; collectionDate: string | null; supersededReason: string | null; apcStatus: string | null; liveInApc: boolean | null; apcError?: string }> = [];
    for (const r of rows.rows) {
      const status = await liveStatusOf(String(r.waybill), base);
      if (status.kind === "ok" && status.dead) {
        await markCancelledInApc(String(r.waybill));
        continue;
      }
      out.push({
        waybill: String(r.waybill),
        collectionDate: collectionDateOf({ waybill: String(r.waybill), collectionDate: r.collection_date, createdAt: r.created_at }),
        supersededReason: r.superseded_reason,
        apcStatus: status.kind === "ok" ? (status.latest?.description ?? null) : r.apc_status,
        liveInApc: status.kind === "ok" ? true : null,
        ...(status.kind === "unreachable" ? { apcError: status.error } : {}),
      });
    }
    res.json({ orderId, oldBookings: out });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[apc-check] old bookings for ${orderId} failed:`, msg);
    res.status(500).json({ error: msg });
  }
});

type CancelRow = {
  waybill: string;
  shopify_order_name: string | null;
  cancelled_at: Date | null;
  superseded_at: Date | null;
  pushed_to_shopify_at: Date | null;
};

async function loadForCancel(waybill: string): Promise<CancelRow | null> {
  const r = await db.execute<CancelRow>(sql`
    SELECT waybill, shopify_order_name, cancelled_at, superseded_at, pushed_to_shopify_at
    FROM apc_consignments WHERE waybill = ${waybill} LIMIT 1
  `);
  return r.rows[0] ?? null;
}

const CancelBody = z.object({
  /** The manager pressed "Yes, cancel it in APC" — nothing is sent without it. */
  confirm: z.literal(true),
});

router.post("/consignments/:waybill/apc-cancel", requireCourier, validate(CancelBody), async (req: Request, res: Response) => {
  const waybill = String(req.params.waybill ?? "");
  if (!/^\d{22}$/.test(waybill)) { res.status(400).json({ error: "Waybill must be 22 digits" }); return; }
  if (isStaging()) { res.status(409).json({ error: "APC cancellations are switched off on staging." }); return; }
  if (!isApcConfigured()) { res.status(503).json({ error: "APC credentials not configured." }); return; }
  try {
    const row = await loadForCancel(waybill);
    if (!row) { res.status(404).json({ error: "We have no record of that consignment." }); return; }
    if (row.cancelled_at) { res.status(409).json({ error: `${waybill} is already marked cancelled.` }); return; }
    // Only a booking the app has already retired — never today's live one.
    if (!row.superseded_at) {
      res.status(409).json({ error: `${waybill} hasn't been replaced, so it may be this order's live booking. Nothing was cancelled.` });
      return;
    }
    if (row.pushed_to_shopify_at) {
      res.status(409).json({ error: `${waybill} was sent to the customer as their tracking number. Nothing was cancelled — sort it out in Hypaship.` });
      return;
    }
    const who = await userName(req);
    try {
      await cancelShipment(waybill, await apcBase());
    } catch (apcErr) {
      const why = apcErr instanceof Error ? apcErr.message : String(apcErr);
      console.warn(`[apc-check] APC refused to cancel ${waybill} for ${who}: ${why}`);
      res.status(502).json({
        error: `APC didn't cancel ${waybill}: ${why}. Cancel it by hand in Hypaship (search for waybill ${waybill}), then press "I'll cancel it in Hypaship".`,
        cancelByHand: true,
      });
      return;
    }
    await db.execute(sql`
      UPDATE apc_consignments SET
        cancelled_at = NOW(),
        cancelled_reason = ${`cancelled in APC from the app by ${who}`},
        apc_cancel_decision = 'cancelled_via_app',
        apc_cancel_decided_by = ${who},
        apc_cancel_decided_at = NOW()
      WHERE waybill = ${waybill}
    `);
    console.log(`[apc-check] ${waybill} (${row.shopify_order_name}) cancelled in APC by ${who}`);
    res.json({ ok: true, waybill });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[apc-check] cancel ${waybill} failed:`, msg);
    res.status(500).json({ error: msg });
  }
});

const DecisionBody = z.object({
  decision: z.enum(["cancel_by_hand", "keep"]),
});

router.post("/consignments/:waybill/apc-cancel-decision", requireCourier, validate(DecisionBody), async (req: Request, res: Response) => {
  const waybill = String(req.params.waybill ?? "");
  const { decision } = req.body as z.infer<typeof DecisionBody>;
  try {
    const who = await userName(req);
    const r = await db.execute(sql`
      UPDATE apc_consignments SET
        apc_cancel_decision = ${decision},
        apc_cancel_decided_by = ${who},
        apc_cancel_decided_at = NOW()
      WHERE waybill = ${waybill} AND superseded_at IS NOT NULL AND apc_cancel_decision IS NULL
      RETURNING waybill
    `);
    if (!r.rows.length) { res.status(404).json({ error: "No old booking waiting on a decision with that waybill." }); return; }
    console.log(`[apc-check] ${waybill}: ${who} chose "${decision}" (told it is still live in APC)`);
    res.json({ ok: true, waybill, decision });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[apc-check] decision for ${waybill} failed:`, msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
