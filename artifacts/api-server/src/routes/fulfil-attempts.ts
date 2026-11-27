/**
 * GET /api/fulfilment/fulfil-attempts/stuck — orders the log says we tried to
 * fulfil in the last 7 days that are STILL open in Shopify, each with its
 * newest attempt and the live APC booking to send. The "Not in Shopify"
 * button on Order Packing Live opens this; fulfilling one goes through the
 * normal POST /orders/:id/complete with that booking, so every gate (stale
 * waybill, barcodes, chargeback) still applies. Shopify is read for each
 * candidate the local order mirror still shows as open (capped at 40).
 *
 * GET /api/fulfilment/fulfil-attempts/:orderId — what the fulfil-attempts log
 * holds for one order over the last 14 days, newest first (Graeme, 27 Nov
 * 2026 — #140447). The packing screen calls it when an order is opened: any
 * row means the order should already have been fulfilled, so it is flagged
 * for a manager. Read-only. Objective C.
 */
import { Router, type Request, type Response } from "express";
import * as z from "zod";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, fulfilAttemptsTable, apcConsignmentsTable, serverStartsTable, fulfilChecksTable, usersTable } from "@workspace/db";
import { requireFulfilmentAccess } from "../lib/fulfilment-access";
import { getOrderById, shopifyAdminOrderBase } from "../services/shopify";
import { bookingToSend, diagnoseStuckFulfil, stillOpenInShopify } from "../lib/fulfil-attempt-rules";
import { isCollectionOrder, isLocalDeliveryTag } from "../lib/dispatch-tag";
import { validate, validateQuery } from "../middleware/validate";

const router = Router();

/** How many other orders were fulfilled after `at` — "about 3 orders ago",
 *  so the packer knows how far back in the stack to look for the box. */
async function ordersFulfilledSince(at: Date, exceptOrderId: number): Promise<number> {
  const r = await db.execute<{ n: string }>(sql`
    SELECT COUNT(DISTINCT shopify_order_id)::text AS n FROM fulfil_attempts
    WHERE outcome = 'fulfilled' AND started_at > ${at} AND shopify_order_id <> ${exceptOrderId}
  `);
  return Number(r.rows[0]?.n ?? 0);
}

const Params = z.object({ orderId: z.coerce.number().int().positive() });
// localAt: when THIS device pressed Complete, for a try that never reached
// the server — so "orders since" still works for it.
const OneQuery = z.object({ localAt: z.coerce.number().int().positive().optional() });
const StuckQuery = z.object({ days: z.coerce.number().int().min(1).max(30).optional() });

router.get("/fulfil-attempts/stuck", requireFulfilmentAccess, validateQuery(StuckQuery), async (_req: Request, res: Response) => {
  const { days = 7 } = res.locals["query"] as z.infer<typeof StuckQuery>;
  try {
    const since = new Date(Date.now() - days * 86_400_000);
    // Candidates, from our own tables only (no Shopify call yet):
    //   - no attempt said "fulfilled" → it should be done but nothing says so;
    //   - one did, but the order mirror has re-synced since and still shows
    //     it open (a fulfilled order changes, so it re-syncs as fulfilled).
    // An order we fulfilled a minute ago is not a candidate just because the
    // mirror hasn't caught up — that keeps Shopify reads near zero normally.
    const cand = await db.execute<{ id: string; name: string | null; customer: string | null }>(sql`
      WITH per AS (
        SELECT shopify_order_id AS id,
               bool_or(outcome = 'fulfilled') AS ok,
               max(finished_at) FILTER (WHERE outcome = 'fulfilled') AS ok_at
        FROM fulfil_attempts
        WHERE started_at >= ${since}
        GROUP BY shopify_order_id
      )
      SELECT per.id::text AS id,
             c.payload->>'name' AS name,
             COALESCE(NULLIF(c.payload->'shipping_address'->>'name', ''),
                      NULLIF(TRIM(CONCAT(c.payload->'customer'->>'first_name', ' ', c.payload->'customer'->>'last_name')), '')) AS customer
      FROM per
      LEFT JOIN shopify_orders_cache c ON c.id = per.id
      WHERE (c.id IS NULL AND NOT per.ok)
         OR (c.id IS NOT NULL
             AND c.payload->>'cancelled_at' IS NULL
             AND COALESCE(c.payload->>'fulfillment_status', '') IN ('', 'partial', 'unfulfilled')
             AND (NOT per.ok OR c.synced_at > per.ok_at + INTERVAL '1 minute'))
      LIMIT 40
    `);
    const ids = cand.rows.map(r => Number(r.id));
    if (ids.length === 0) {
      res.json({ orders: [], adminBase: shopifyAdminOrderBase() });
      return;
    }
    const [attempts, ledger, live] = await Promise.all([
      db.select().from(fulfilAttemptsTable)
        .where(and(inArray(fulfilAttemptsTable.shopifyOrderId, ids), gte(fulfilAttemptsTable.startedAt, since)))
        .orderBy(desc(fulfilAttemptsTable.startedAt)),
      db.select({
        orderId: apcConsignmentsTable.shopifyOrderId,
        waybill: apcConsignmentsTable.waybill,
        trackingUrl: apcConsignmentsTable.trackingUrl,
        createdAt: apcConsignmentsTable.createdAt,
        cancelledAt: apcConsignmentsTable.cancelledAt,
        supersededAt: apcConsignmentsTable.supersededAt,
      }).from(apcConsignmentsTable).where(inArray(apcConsignmentsTable.shopifyOrderId, ids)),
      // The mirror can lag a few minutes — Shopify itself has the last word.
      Promise.all(ids.map(id => getOrderById(id))),
    ]);
    const rows = await Promise.all(ids.map(async (id, i) => {
      const o = live[i];
      // Shopify unreadable → keep it, saying so, rather than hide it.
      if (o && !stillOpenInShopify(o)) return null;
      const mine = attempts.filter(a => a.shopifyOrderId === id);
      const last = mine[0];
      const first = mine[mine.length - 1];
      const tags = (o?.tags ?? "").split(",").map(t => t.trim().toLowerCase());
      const noCourier = !!o && (tags.some(isLocalDeliveryTag) || isCollectionOrder(o.tags));
      const c = cand.rows[i];
      return {
        orderId: id,
        orderName: o?.name ?? c?.name ?? String(id),
        customerName: c?.customer ?? ([o?.customer?.first_name, o?.customer?.last_name].filter(Boolean).join(" ") || null),
        shopifyUnreadable: !o,
        attempts: mine.length,
        // When it should have gone, who pressed Complete, and how many
        // orders have gone since — where to look in the stack for the box.
        firstAttempt: first ? { at: first.startedAt, by: first.userName } : null,
        ordersSince: first ? await ordersFulfilledSince(first.startedAt, id) : null,
        lastAttempt: last ? { at: last.startedAt, by: last.userName, outcome: last.outcome, error: last.error } : null,
        booking: noCourier ? null : bookingToSend(ledger.filter(r => r.orderId === id).map(r => ({ ...r, trackingUrl: r.trackingUrl ?? null }))),
        noCourier,
      };
    }));
    const orders = rows.filter((r): r is NonNullable<typeof r> => r !== null);
    res.json({ orders, adminBase: shopifyAdminOrderBase() });
  } catch (err) {
    console.error("[fulfil-attempts] stuck list failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Couldn't build the list" });
  }
});

/**
 * Everything the packer's checklist needs for one order, with the automatic
 * checks (lib/fulfil-attempt-rules.ts diagnoseStuckFulfil). Read-only.
 */
async function buildDiagnosis(orderId: number, localAt: number | null) {
  const since = new Date(Date.now() - 14 * 86_400_000);
  const attempts = await db.select().from(fulfilAttemptsTable)
    .where(and(eq(fulfilAttemptsTable.shopifyOrderId, orderId), gte(fulfilAttemptsTable.startedAt, since)))
    .orderBy(desc(fulfilAttemptsTable.startedAt));
  const firstAt = [attempts.length ? attempts[attempts.length - 1].startedAt.getTime() : null, localAt]
    .filter((x): x is number => x != null).sort((a, b) => a - b)[0] ?? null;
  const [starts, ledger, order, cache, checks] = await Promise.all([
    firstAt != null
      ? db.select({ at: serverStartsTable.startedAt }).from(serverStartsTable).where(gte(serverStartsTable.startedAt, new Date(firstAt - 3600_000)))
      : Promise.resolve([] as Array<{ at: Date }>),
    db.select({
      waybill: apcConsignmentsTable.waybill,
      trackingUrl: apcConsignmentsTable.trackingUrl,
      createdAt: apcConsignmentsTable.createdAt,
      cancelledAt: apcConsignmentsTable.cancelledAt,
      supersededAt: apcConsignmentsTable.supersededAt,
      labelPrintedAt: apcConsignmentsTable.labelPrintedAt,
    }).from(apcConsignmentsTable).where(eq(apcConsignmentsTable.shopifyOrderId, orderId)),
    getOrderById(orderId),
    db.execute<{ name: string | null; customer: string | null }>(sql`
      SELECT payload->>'name' AS name,
             COALESCE(NULLIF(payload->'shipping_address'->>'name', ''),
                      NULLIF(TRIM(CONCAT(payload->'customer'->>'first_name', ' ', payload->'customer'->>'last_name')), '')) AS customer
      FROM shopify_orders_cache WHERE id = ${orderId}
    `),
    db.select().from(fulfilChecksTable).where(eq(fulfilChecksTable.shopifyOrderId, orderId)).orderBy(desc(fulfilChecksTable.createdAt)).limit(5),
  ]);
  const send = bookingToSend(ledger.map(r => ({ ...r, trackingUrl: r.trackingUrl ?? null })));
  const live = send ? ledger.find(r => r.waybill === send.waybill) ?? null : null;
  const tags = (order?.tags ?? "").split(",").map(t => t.trim().toLowerCase());
  const noCourier = !!order && (tags.some(isLocalDeliveryTag) || isCollectionOrder(order.tags));
  const diagnosis = diagnoseStuckFulfil({
    attempts: attempts.map(a => ({ outcome: a.outcome, startedAt: a.startedAt, error: a.error, consignmentNumber: a.consignmentNumber })),
    localAt,
    serverStarts: starts.map(x => x.at),
    shopifyOpen: order ? stillOpenInShopify(order) : null,
    booking: live ? { waybill: live.waybill, labelPrintedAt: live.labelPrintedAt } : null,
    noCourier,
  });
  const c = cache.rows[0];
  return {
    orderId,
    orderName: order?.name ?? c?.name ?? String(orderId),
    customerName: c?.customer ?? null,
    firstAttemptBy: attempts[attempts.length - 1]?.userName ?? null,
    ordersSince: firstAt != null ? await ordersFulfilledSince(new Date(firstAt), orderId) : null,
    booking: noCourier ? null : send,
    noCourier,
    ...diagnosis,
    previousChecks: checks.map(k => ({ at: k.createdAt, by: k.userName, found: k.found, outcome: k.outcome })),
  };
}

// GET /api/fulfilment/fulfil-attempts/:orderId/diagnosis?localAt= — the
// checklist's automatic checks.
router.get("/fulfil-attempts/:orderId/diagnosis", requireFulfilmentAccess, validateQuery(OneQuery), async (req: Request, res: Response) => {
  const parsed = Params.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid order id" }); return; }
  const { localAt } = res.locals["query"] as z.infer<typeof OneQuery>;
  try {
    res.json(await buildDiagnosis(parsed.data.orderId, localAt ?? null));
  } catch (err) {
    console.error("[fulfil-attempts] diagnosis failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Couldn't run the checks" });
  }
});

// POST /api/fulfilment/fulfil-attempts/:orderId/check — record the packer's
// answer. The checks are re-run HERE (never taken from the browser) and
// stored with it; the answer says whether the fix is allowed.
//   found false            → 'not-found'  (escalate)
//   found true, outcome …  → 'escalated' (checks failed) | 'fixing' | 'fixed'
const CheckBody = z.object({
  found: z.boolean(),
  outcome: z.enum(["not-found", "escalated", "fixing", "fixed"]),
  localAt: z.number().int().positive().optional(),
});
router.post("/fulfil-attempts/:orderId/check", requireFulfilmentAccess, validate(CheckBody), async (req: Request, res: Response) => {
  const parsed = Params.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid order id" }); return; }
  const body = req.body as z.infer<typeof CheckBody>;
  try {
    const d = await buildDiagnosis(parsed.data.orderId, body.localAt ?? null);
    // "fixing" is only allowed when every check passes; otherwise it's
    // recorded as escalated and the screen says so.
    const outcome = !body.found ? "not-found" : body.outcome === "fixing" && !d.canFix ? "escalated" : body.outcome;
    const uid = req.session?.userId ?? null;
    const [u] = uid ? await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, uid)) : [];
    await db.insert(fulfilChecksTable).values({
      shopifyOrderId: parsed.data.orderId,
      userId: uid,
      userName: u?.name ?? null,
      found: body.found,
      outcome,
      diagnosis: { checks: d.checks, canFix: d.canFix, completeAt: d.completeAt, booking: d.booking },
    });
    console.log(`[fulfil-check] order ${d.orderName}: found=${body.found} → ${outcome}${d.canFix ? "" : ` (failed: ${d.checks.filter(c => !c.ok).map(c => c.key).join(", ")})`}`);
    res.json({ outcome, canFix: d.canFix && body.found, booking: d.booking, noCourier: d.noCourier, checks: d.checks });
  } catch (err) {
    console.error("[fulfil-attempts] check failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Couldn't record the check" });
  }
});

router.get("/fulfil-attempts/:orderId", requireFulfilmentAccess, validateQuery(OneQuery), async (req: Request, res: Response) => {
  const parsed = Params.safeParse(req.params);
  const { localAt } = res.locals["query"] as z.infer<typeof OneQuery>;
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid order id" });
    return;
  }
  try {
    const since = new Date(Date.now() - 14 * 86_400_000);
    const rows = await db.select({
      id: fulfilAttemptsTable.id,
      startedAt: fulfilAttemptsTable.startedAt,
      finishedAt: fulfilAttemptsTable.finishedAt,
      outcome: fulfilAttemptsTable.outcome,
      error: fulfilAttemptsTable.error,
      userName: fulfilAttemptsTable.userName,
      consignmentNumber: fulfilAttemptsTable.consignmentNumber,
      tryNumber: fulfilAttemptsTable.tryNumber,
    })
      .from(fulfilAttemptsTable)
      .where(and(eq(fulfilAttemptsTable.shopifyOrderId, parsed.data.orderId), gte(fulfilAttemptsTable.startedAt, since)))
      .orderBy(desc(fulfilAttemptsTable.startedAt))
      .limit(10);
    const firstServer = rows.length ? new Date(rows[rows.length - 1].startedAt) : null;
    const local = localAt ? new Date(localAt) : null;
    const from = firstServer && local ? (firstServer < local ? firstServer : local) : (firstServer ?? local);
    res.json({ attempts: rows, ordersSince: from ? await ordersFulfilledSince(from, parsed.data.orderId) : null });
  } catch (err) {
    console.error("[fulfil-attempts] lookup failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Couldn't read the fulfil log" });
  }
});

export default router;
