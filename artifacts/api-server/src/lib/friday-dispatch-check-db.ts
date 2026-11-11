/**
 * Friday dispatch check — the database half. The rules are pure, in
 * friday-dispatch-check.ts.
 *
 *   past Saturday refusals  apc_booking_issues (migration 0156): a booking
 *                           that tried a Saturday and APC refused for "no
 *                           service". Read only.
 *   what was done           friday_check_actions (migration 0367): emails
 *                           sent and moves made from the check.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { addDaysToDateString } from "./london-time";
import { lookupPostcodeService, outwardCode } from "../services/apc-postinfo";
import { DEPOT_REFUSAL_DAYS, type DepotRefusal, type FridayAction } from "./friday-dispatch-check";

type RefusalRow = {
  report_date: string;
  order_name: string;
  postcode: string | null;
  depot: string | null;
  matched_on: string | null;
  table_saturday: boolean | null;
};

/** Saturday refusals in the DEPOT_REFUSAL_DAYS before `dispatchDate`.
 *  The depot and the table's own Saturday answer come from the snapshot
 *  taken at booking time; rows from before that snapshot carried them are
 *  looked up in the table again (without recorded APC answers — the point
 *  is what the table PROMISED). */
export async function loadRecentSaturdayRefusals(dispatchDate: string): Promise<DepotRefusal[]> {
  const from = addDaysToDateString(dispatchDate, -DEPOT_REFUSAL_DAYS);
  const r = await db.execute<RefusalRow>(sql`
    SELECT report_date::text AS report_date, order_name, postcode,
           postcode_service->>'depot' AS depot,
           postcode_service->>'matchedOn' AS matched_on,
           (postcode_service->>'tableSaturdayDelivery')::boolean AS table_saturday
    FROM apc_booking_issues
    WHERE saturday_attempt AND refused_no_service
      AND report_date >= ${from}::date AND report_date < ${dispatchDate}::date
  `);
  const out: DepotRefusal[] = [];
  for (const row of r.rows) {
    const fresh = row.depot && row.table_saturday != null ? null : lookupPostcodeService(row.postcode);
    const depot = row.depot || fresh?.depot || "";
    if (!depot) continue;
    out.push({
      reportDate: row.report_date,
      depot,
      outward: row.matched_on || fresh?.matchedOn || (row.postcode ? outwardCode(row.postcode) : ""),
      orderName: row.order_name,
      tableListedSaturday: row.table_saturday ?? fresh?.listed.saturdayDelivery ?? false,
    });
  }
  return out;
}

type ActionRow = { shopify_order_id: string | number; order_name: string; kind: string; detail: string | null; by_name: string | null; at: string };

export async function loadFridayActions(dispatchDate: string): Promise<FridayAction[]> {
  const r = await db.execute<ActionRow>(sql`
    SELECT shopify_order_id, order_name, kind, detail, by_name,
           to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at
    FROM friday_check_actions
    WHERE dispatch_date = ${dispatchDate}::date
    ORDER BY at, id
  `);
  return r.rows.map(x => ({
    orderId: Number(x.shopify_order_id),
    orderName: x.order_name,
    kind: x.kind === "moved" ? "moved" : "emailed",
    detail: x.detail,
    byName: x.by_name,
    at: x.at,
  }));
}

export async function recordFridayAction(a: {
  dispatchDate: string; orderId: number; orderName: string; kind: "emailed" | "moved";
  detail: string | null; byUserId: number | null; byName: string | null;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO friday_check_actions (dispatch_date, shopify_order_id, order_name, kind, detail, by_user_id, by_name)
    VALUES (${a.dispatchDate}::date, ${a.orderId}, ${a.orderName}, ${a.kind}, ${a.detail}, ${a.byUserId}, ${a.byName})
  `);
}
