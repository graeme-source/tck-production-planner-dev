/**
 * The fried chicken "send the day's counted bags to Shopify" record — and the
 * rule that it goes ONCE per production plan (Graeme, 2026-10-12: "let's
 * disable the ability to send it again. We don't want someone to accidentally
 * send it").
 *
 * The send ADDS to the shelf, so a second send doubles it. Until 12 Oct a
 * second send was refused unless the screen asked to "force" it, and the
 * check-then-send was not atomic — two taps at once could both pass the check
 * and both add the stock. Now:
 *
 *  - The plan's record row in app_settings (key below, UNIQUE in the DB) is
 *    CLAIMED before anything goes to Shopify, with
 *    INSERT … ON CONFLICT DO NOTHING RETURNING. Exactly one request can win
 *    that insert; every other one — a double tap, a second iPad, the closing
 *    check, an old cached screen still sending force:true — gets a 409.
 *  - Once the Shopify calls finish, the claim is turned into the final record
 *    (when + how many bags). If NOTHING landed (every line failed), the claim
 *    is released so the day's stock isn't stranded.
 *  - If the server dies mid-send the claim stays as "sending". That blocks a
 *    resend on purpose: some lines may have landed, and the safe next step is
 *    to look at Shopify's inventory history, not to send again.
 *
 * There is no "send again" — a correction is made in Shopify admin.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, appSettingsTable } from "@workspace/db";
import { parseStockSendRecord, stockSendKey, type StockSendRecord } from "./fried-chicken-stock-send-rules";

export { alreadySentMessage, type StockSendRecord } from "./fried-chicken-stock-send-rules";

export async function readStockSend(planId: number): Promise<StockSendRecord | null> {
  const [row] = await db.select({ value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, stockSendKey(planId)));
  return row ? parseStockSendRecord(row.value) : null;
}

/** Claim the plan's one send. Returns null if this request won the claim,
 *  otherwise the record that is already there. Atomic: relies on the UNIQUE
 *  constraint on app_settings.key (app_settings_key_key). */
export async function claimStockSend(planId: number, by: number | null): Promise<StockSendRecord | null> {
  const claim: StockSendRecord = { at: new Date().toISOString(), by, bags: 0, status: "sending" };
  const inserted = await db.insert(appSettingsTable)
    .values({ key: stockSendKey(planId), value: JSON.stringify(claim) })
    .onConflictDoNothing({ target: appSettingsTable.key })
    .returning({ id: appSettingsTable.id });
  if (inserted.length > 0) return null;
  return (await readStockSend(planId)) ?? claim;
}

/** Turn the claim into the finished record. */
export async function finishStockSend(planId: number, by: number | null, bags: number): Promise<StockSendRecord> {
  const record: StockSendRecord = { at: new Date().toISOString(), by, bags, status: "sent" };
  await db.update(appSettingsTable)
    .set({ value: JSON.stringify(record), updatedAt: new Date() })
    .where(eq(appSettingsTable.key, stockSendKey(planId)));
  return record;
}

/** Give the claim back — only when nothing reached Shopify. Only removes a
 *  claim still marked "sending", never a finished record. */
export async function releaseStockSend(planId: number): Promise<void> {
  await db.delete(appSettingsTable).where(and(
    eq(appSettingsTable.key, stockSendKey(planId)),
    sql`${appSettingsTable.value}::jsonb->>'status' = 'sending'`,
  ));
}
