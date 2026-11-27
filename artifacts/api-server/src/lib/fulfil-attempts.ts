/**
 * Fulfil attempts log (Graeme, 27 Nov 2026 — #140447 was scanned, the screen
 * moved on, and the order came back unfulfilled with nothing to say why).
 *
 * Every fulfil request writes a row BEFORE Shopify is called and finishes it
 * from the HTTP answer the packing screen actually got, so:
 *   started   → the server stopped part-way (crash / restart)
 *   fulfilled → we told the screen it worked
 *   refused   → a 4xx gate said no (barcode, stale waybill, chargeback…)
 *   failed    → a 5xx (usually Shopify)
 * An order still on the pack list with any row here should already have been
 * fulfilled; the packing screen flags it when it is opened
 * (GET /api/fulfilment/fulfil-attempts/:orderId). Logging never blocks or
 * slows a fulfilment: every DB error here is swallowed. Objective C.
 */
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, fulfilAttemptsTable, usersTable } from "@workspace/db";
import { attemptOutcome } from "./fulfil-attempt-rules";

async function userName(req: Request): Promise<string | null> {
  const id = req.session?.userId;
  if (!id) return null;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
  return u?.name ?? `user ${id}`;
}

/**
 * Record the attempt now and finish the row when the response is sent.
 * Call once, at the top of the handler, before any early return.
 */
export async function trackFulfilAttempt(
  req: Request,
  res: Response,
  opts: { orderId: number; route: string; consignmentNumber?: string | null; clientAttemptId?: string | null; tryNumber?: number | null },
): Promise<void> {
  let rowId: number | null = null;
  try {
    const [row] = await db.insert(fulfilAttemptsTable).values({
      shopifyOrderId: opts.orderId,
      route: opts.route,
      consignmentNumber: opts.consignmentNumber || null,
      clientAttemptId: opts.clientAttemptId || null,
      tryNumber: opts.tryNumber ?? null,
      userId: req.session?.userId ?? null,
      userName: await userName(req),
    }).returning({ id: fulfilAttemptsTable.id });
    rowId = row?.id ?? null;
  } catch (err) {
    console.warn(`[fulfil-attempts] couldn't record attempt for order ${opts.orderId}:`, err instanceof Error ? err.message : err);
    return;
  }

  let body: unknown = null;
  const json = res.json.bind(res);
  res.json = ((b: unknown) => { body = b; return json(b); }) as Response["json"];
  let done = false;
  const finish = () => {
    if (done || rowId == null) return;
    done = true;
    // Closed without a finished response = the screen never got an answer.
    const status = res.writableFinished ? res.statusCode : 0;
    const { outcome, error } = status === 0
      ? { outcome: "failed" as const, error: "Connection closed before the server answered" }
      : attemptOutcome(status, body);
    db.update(fulfilAttemptsTable)
      .set({ finishedAt: new Date(), outcome, httpStatus: status || null, error })
      .where(eq(fulfilAttemptsTable.id, rowId))
      .catch(err => console.warn(`[fulfil-attempts] couldn't finish attempt ${rowId}:`, err instanceof Error ? err.message : err));
    console.log(`[fulfil-attempts] order ${opts.orderId} ${opts.route} → ${outcome}${error ? ` (${error.slice(0, 200)})` : ""}`);
  };
  res.on("finish", finish);
  res.on("close", finish);
}
