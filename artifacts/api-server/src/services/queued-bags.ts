/**
 * Queued 8-pack bag orders (Graeme, 22 Nov 2026: "exactly the same process,
 * but it's just a queued version … the 8-pack bags will definitely get added
 * to the relevant production day"). Migration 0391; rules in
 * lib/queued-bags-rules.ts; queued from routes/wholesale-bags.ts.
 *
 * The bags go on the plan exactly as Process puts them: the plan dated the
 * make-day, `eight_pack_bag_count + bags` on that recipe's plan rows. They're
 * applied
 *   - by a sweep every minute, whatever made the plan — but only once the
 *     plan is an hour old (27 Nov 2026: plans are often deleted and made
 *     again in the first half hour). The call straight after a plan is
 *     saved (POST /production-plans) just records when they'll go on,
 * each row in its own transaction, locked, so a row is applied once. An
 * applied row whose plan is deleted goes back to waiting and is re-applied
 * to the next plan for that day.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { londonDateString } from "../lib/london-time";
import { bagsToAdd, isOverdue, planReadyForQueuedBags, waitingBagsByRecipe, type QueuedLine } from "../lib/queued-bags-rules";

export interface QueuedBagOrder {
  id: number;
  shopifyOrderId: number;
  orderName: string;
  customerName: string | null;
  deliveryDate: string;
  productionDate: string;
  lines: QueuedLine[];
  status: "queued" | "applied" | "cancelled";
  problem: string | null;
  planId: number | null;
  appliedAt: string | null;
  queuedByName: string | null;
  createdAt: string;
  overdue: boolean;
}

function niceDay(d: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

async function tableReady(): Promise<boolean> {
  const r = await db.execute<{ ok: string | null }>(sql`SELECT to_regclass('public.queued_bag_orders')::text AS ok`);
  return Boolean(r.rows[0]?.ok);
}

/** Every queue entry not cancelled, waiting first, then by make-day. */
export async function listQueuedBagOrders(opts: { productionDate?: string; includeApplied?: boolean } = {}): Promise<QueuedBagOrder[]> {
  if (!(await tableReady())) return [];
  const r = await db.execute<Record<string, unknown>>(sql`
    SELECT id, shopify_order_id, order_name, customer_name,
           to_char(delivery_date, 'YYYY-MM-DD') AS delivery_date, to_char(production_date, 'YYYY-MM-DD') AS production_date,
           lines, status, problem, plan_id, applied_at, queued_by_name, created_at
      FROM queued_bag_orders
     WHERE status <> 'cancelled'
       ${opts.productionDate ? sql`AND production_date = ${opts.productionDate}` : sql``}
       ${opts.includeApplied ? sql`` : sql`AND (status = 'queued' OR plan_id IS NULL)`}
     ORDER BY production_date, id
  `);
  const today = londonDateString();
  return r.rows.map(x => {
    const row = {
      id: Number(x.id), shopifyOrderId: Number(x.shopify_order_id), orderName: String(x.order_name),
      customerName: (x.customer_name as string | null) ?? null,
      deliveryDate: String(x.delivery_date), productionDate: String(x.production_date),
      lines: (x.lines as QueuedLine[]) ?? [], status: x.status as QueuedBagOrder["status"],
      problem: (x.problem as string | null) ?? null, planId: x.plan_id == null ? null : Number(x.plan_id),
      appliedAt: x.applied_at ? new Date(x.applied_at as string).toISOString() : null,
      queuedByName: (x.queued_by_name as string | null) ?? null,
      createdAt: new Date(x.created_at as string).toISOString(),
    };
    return { ...row, overdue: isOverdue(row, today) };
  });
}

/** Bags waiting for `planDate` per recipe — Create Plan counts them so the
 *  plan is made big enough for them (they go on an hour after it's made). */
export async function waitingBagsForDate(planDate: string): Promise<Map<number, number>> {
  try {
    return waitingBagsByRecipe(await listQueuedBagOrders({ productionDate: planDate }));
  } catch (err) {
    console.error("[queued-bags] couldn't read waiting bags for", planDate, err);
    return new Map();
  }
}

/** Put one queued order's bags on its plan if it can go on now. */
async function applyOne(id: number): Promise<"applied" | "waiting" | "skipped"> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<{ id: number; production_date: string; lines: QueuedLine[]; problem: string | null }>(sql`
      SELECT id, to_char(production_date, 'YYYY-MM-DD') AS production_date, lines, problem
        FROM queued_bag_orders
       WHERE id = ${id} AND (status = 'queued' OR (status = 'applied' AND plan_id IS NULL))
       FOR UPDATE
    `);
    const row = rows.rows[0];
    if (!row) return "skipped";
    // The plan for the make-day — the same pick as Process (the newest when
    // two share a date).
    const plans = await tx.execute<{ id: number; created_at: Date }>(sql`
      SELECT id, created_at FROM production_plans WHERE plan_date = ${row.production_date} ORDER BY id DESC LIMIT 1
    `);
    const plan = plans.rows[0] ?? null;
    // A new plan waits an hour before its queued bags go on (27 Nov 2026):
    // plans are often deleted and made again in the first half hour.
    if (plan) {
      const wait = planReadyForQueuedBags(plan.created_at, new Date());
      if (!wait.ready) {
        const at = wait.readyAt.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
        const problem = `Goes on the ${niceDay(row.production_date)} plan at ${at}, an hour after it was made`;
        if (problem !== row.problem) await tx.execute(sql`UPDATE queued_bag_orders SET problem = ${problem} WHERE id = ${id}`);
        return "waiting";
      }
    }
    const planId = plan?.id ?? null;
    let recipes: Set<number> | null = null;
    if (planId != null) {
      const items = await tx.execute<{ recipe_id: number | null }>(sql`
        SELECT recipe_id FROM production_plan_items WHERE plan_id = ${planId}
      `);
      recipes = new Set(items.rows.map(i => i.recipe_id).filter((r): r is number => r != null));
    }
    const outcome = bagsToAdd(row.lines, recipes, niceDay(row.production_date));
    if (!outcome.ok) {
      if (outcome.problem !== row.problem) {
        await tx.execute(sql`UPDATE queued_bag_orders SET problem = ${outcome.problem} WHERE id = ${id}`);
      }
      return "waiting";
    }
    for (const a of outcome.adds) {
      // Exactly what Process does.
      await tx.execute(sql`
        UPDATE production_plan_items
           SET eight_pack_bag_count = eight_pack_bag_count + ${a.bags}
         WHERE plan_id = ${planId} AND recipe_id = ${a.recipeId}
      `);
    }
    await tx.execute(sql`
      UPDATE queued_bag_orders SET status = 'applied', plan_id = ${planId}, applied_at = NOW(), problem = NULL WHERE id = ${id}
    `);
    console.log(`[queued-bags] queued order ${id} → plan ${planId}: ${outcome.adds.map(a => `${a.bags} × ${a.recipeName}`).join(", ")}`);
    return "applied";
  });
}

/** Apply every waiting order that can go on now — or only those for one
 *  make-day (right after that day's plan is saved). Never throws. */
export async function applyQueuedBags(productionDate?: string): Promise<number> {
  let applied = 0;
  try {
    if (!(await tableReady())) return 0;
    const waiting = await db.execute<{ id: number }>(sql`
      SELECT id FROM queued_bag_orders
       WHERE (status = 'queued' OR (status = 'applied' AND plan_id IS NULL))
         ${productionDate ? sql`AND production_date = ${productionDate}` : sql``}
       ORDER BY id
    `);
    for (const { id } of waiting.rows) {
      try {
        if (await applyOne(id) === "applied") applied++;
      } catch (err) {
        console.error(`[queued-bags] applying queued order ${id} failed (will retry):`, err);
      }
    }
  } catch (err) {
    console.error("[queued-bags] sweep failed (will retry):", err);
  }
  return applied;
}

let started = false;
/** The every-minute sweep: whatever made a plan, its queued bags go on. */
export function startQueuedBagsScheduler(): void {
  if (started) return;
  started = true;
  setTimeout(() => void applyQueuedBags(), 30_000).unref();
  setInterval(() => void applyQueuedBags(), 60_000).unref();
}
