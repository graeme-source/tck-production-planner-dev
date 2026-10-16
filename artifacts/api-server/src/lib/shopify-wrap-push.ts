/**
 * Wrap-to-Shopify — the ledger writes and the one Shopify call. The rules
 * (event keys, the request, reading the answer, what the screen says) are
 * pure in ./shopify-wrap-push-rules.ts; read that first.
 *
 * Flow for one wrap tap (+N) or take-back (−N) on a recipe flagged
 * shopify_push_on_wrap:
 *   recordWrapPush  INSERT … ON CONFLICT (event_key) DO NOTHING — the claim.
 *                   A repeat of the same event finds its row and sends nothing.
 *   sendWrapPush    UPDATE … SET status='sending' WHERE status IN
 *                   ('pending','failed') — only one caller wins — then the
 *                   Shopify call, then sent / failed / skipped.
 *   retryWrapPush   failed rows only.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, appSettingsTable, recipesTable, shopifyWrapPushesTable } from "@workspace/db";
import {
  WRAP_LOCATION_SETTING_KEY, buildInventoryAdjustRequest, canRetry, itemShopifyState, locationGid,
  parseInventoryAdjustResponse, wrapEventKey, wrapPushDelta,
  type AdjustResponse, type ItemShopifyState, type WrapPushKind, type WrapPushRow, type WrapPushStatus,
} from "./shopify-wrap-push-rules";
import { ShopifyWritesBlockedError, getVariantInventoryItem, sendInventoryAdjust, shopifyWritesBlocked } from "../services/shopify";

export const WRITES_OFF_MESSAGE = "Not sent — Shopify writes are switched off on this server, so Shopify was not changed.";

export async function getWrapLocationSetting(): Promise<string | null> {
  const [row] = await db.select({ value: appSettingsTable.value }).from(appSettingsTable)
    .where(eq(appSettingsTable.key, WRAP_LOCATION_SETTING_KEY));
  return locationGid(row?.value ?? null);
}

export async function setWrapLocationSetting(gid: string | null): Promise<void> {
  if (gid === null) {
    await db.delete(appSettingsTable).where(eq(appSettingsTable.key, WRAP_LOCATION_SETTING_KEY));
    return;
  }
  await db.insert(appSettingsTable).values({ key: WRAP_LOCATION_SETTING_KEY, value: gid })
    .onConflictDoUpdate({ target: appSettingsTable.key, set: { value: gid, updatedAt: new Date() } });
}

type Row = typeof shopifyWrapPushesTable.$inferSelect;

function toRow(r: Row): WrapPushRow & { sentAt: Date | null; quantityAfter: number | null; attempts: number; createdAt: Date } {
  return {
    id: r.id, planItemId: r.planItemId, kind: r.kind as WrapPushKind, delta: r.delta,
    status: r.status as WrapPushStatus, error: r.error, updatedAt: r.updatedAt,
    sentAt: r.sentAt, quantityAfter: r.quantityAfter, attempts: r.attempts, createdAt: r.createdAt,
  };
}

async function recipePushesOnWrap(recipeId: number): Promise<boolean> {
  const [r] = await db.select({ on: recipesTable.shopifyPushOnWrap }).from(recipesTable).where(eq(recipesTable.id, recipeId));
  return r?.on === true;
}

async function mappedVariant(recipeId: number): Promise<string | null> {
  const rows = await db.execute<{ shopify_variant_id: string | null }>(sql`
    SELECT shopify_variant_id FROM recipe_shopify_mappings
    WHERE recipe_id = ${recipeId} AND shopify_variant_id IS NOT NULL
    ORDER BY id LIMIT 1
  `);
  const v = rows.rows[0]?.shopify_variant_id;
  return v ? String(v) : null;
}

export interface RecordWrapPushInput {
  kind: WrapPushKind;
  planId: number;
  planItemId: number;
  recipeId: number;
  packs: number;
  clientEventId: string;
  userId: number | null;
}

/**
 * Claim and send one wrap event. Returns null when the recipe doesn't push
 * on wrap (nothing to do). Never throws for a Shopify problem — the row
 * records it and the screen shows it.
 */
export async function recordWrapPush(input: RecordWrapPushInput): Promise<ReturnType<typeof toRow> | null> {
  if (!(await recipePushesOnWrap(input.recipeId))) return null;
  const eventKey = wrapEventKey(input.kind, input.planItemId, input.clientEventId);
  const delta = wrapPushDelta(input.kind, input.packs);
  const variantId = await mappedVariant(input.recipeId);
  const inserted = await db.insert(shopifyWrapPushesTable).values({
    eventKey, kind: input.kind, planId: input.planId, planItemId: input.planItemId, recipeId: input.recipeId,
    variantId, delta, status: "pending", userId: input.userId,
  }).onConflictDoNothing({ target: shopifyWrapPushesTable.eventKey }).returning({ id: shopifyWrapPushesTable.id });
  if (inserted.length === 0) {
    // The same event again (double tap / replay): report it, send nothing.
    const [existing] = await db.select().from(shopifyWrapPushesTable).where(eq(shopifyWrapPushesTable.eventKey, eventKey));
    return existing ? toRow(existing) : null;
  }
  return sendWrapPush(inserted[0].id);
}

/** Send one ledger row if it is pending or failed. Only one caller can win
 *  the claim; everyone else gets the row as it stands. */
export async function sendWrapPush(id: number): Promise<ReturnType<typeof toRow> | null> {
  const [claimed] = await db.update(shopifyWrapPushesTable)
    .set({ status: "sending", attempts: sql`${shopifyWrapPushesTable.attempts} + 1`, error: null, updatedAt: new Date() })
    .where(and(eq(shopifyWrapPushesTable.id, id), inArray(shopifyWrapPushesTable.status, ["pending", "failed"])))
    .returning();
  if (!claimed) {
    const [row] = await db.select().from(shopifyWrapPushesTable).where(eq(shopifyWrapPushesTable.id, id));
    return row ? toRow(row) : null;
  }

  const finish = async (status: WrapPushStatus, fields: { error?: string | null; quantityAfter?: number | null; locationId?: string | null } = {}) => {
    const [row] = await db.update(shopifyWrapPushesTable).set({
      status,
      error: fields.error ?? null,
      quantityAfter: fields.quantityAfter ?? null,
      ...(fields.locationId !== undefined ? { locationId: fields.locationId } : {}),
      sentAt: status === "sent" ? new Date() : null,
      updatedAt: new Date(),
    }).where(eq(shopifyWrapPushesTable.id, id)).returning();
    if (status === "sent") console.log(`[shopify-wrap-push] ${claimed.kind} ${claimed.delta > 0 ? "+" : ""}${claimed.delta} sent (push ${id}, item ${claimed.planItemId})`);
    else console.warn(`[shopify-wrap-push] push ${id} ${status}: ${fields.error ?? ""}`);
    return toRow(row);
  };

  // Checked before anything else (even reads): this server may not write.
  if (shopifyWritesBlocked()) return finish("skipped", { error: WRITES_OFF_MESSAGE });
  if (!claimed.variantId) return finish("failed", { error: "This recipe isn't linked to a Shopify variant — link it, then retry." });
  const location = await getWrapLocationSetting();
  if (!location) return finish("failed", { error: "No Shopify location is chosen for wrapping yet — an admin sets it on the recipe's production route, then retry." });

  try {
    const item = await getVariantInventoryItem(claimed.variantId);
    if (!item) return finish("failed", { error: `Shopify doesn't know variant ${claimed.variantId}.`, locationId: location });
    if (!item.tracked) return finish("failed", { error: "Shopify isn't tracking stock for this variant.", locationId: location });
    const request = buildInventoryAdjustRequest({
      eventKey: claimed.eventKey, kind: claimed.kind as WrapPushKind, delta: claimed.delta,
      inventoryItemGid: item.inventoryItemGid, locationGid: location,
    });
    const data = await sendInventoryAdjust<AdjustResponse>(request);
    const parsed = parseInventoryAdjustResponse(data);
    return parsed.ok
      ? finish("sent", { quantityAfter: parsed.quantityAfter, locationId: location })
      : finish("failed", { error: parsed.error, locationId: location });
  } catch (err) {
    if (err instanceof ShopifyWritesBlockedError) return finish("skipped", { error: WRITES_OFF_MESSAGE, locationId: location });
    return finish("failed", { error: err instanceof Error ? err.message : String(err), locationId: location });
  }
}

export async function retryWrapPush(id: number): Promise<{ ok: true; row: ReturnType<typeof toRow> } | { ok: false; status: number; error: string }> {
  const [row] = await db.select().from(shopifyWrapPushesTable).where(eq(shopifyWrapPushesTable.id, id));
  if (!row) return { ok: false, status: 404, error: "Not found" };
  if (!canRetry(row.status as WrapPushStatus)) return { ok: false, status: 409, error: `This update is ${row.status} — only a failed update can be retried.` };
  const sent = await sendWrapPush(id);
  return sent ? { ok: true, row: sent } : { ok: false, status: 404, error: "Not found" };
}

/** Every push on a plan, newest first, plus each item's on-screen state. */
export async function listWrapPushes(planId: number): Promise<{ pushes: ReturnType<typeof toRow>[]; byItem: Record<number, ItemShopifyState> }> {
  const rows = (await db.select().from(shopifyWrapPushesTable)
    .where(eq(shopifyWrapPushesTable.planId, planId))
    .orderBy(desc(shopifyWrapPushesTable.createdAt))).map(toRow);
  const grouped = new Map<number, WrapPushRow[]>();
  for (const r of rows) (grouped.get(r.planItemId) ?? grouped.set(r.planItemId, []).get(r.planItemId)!).push(r);
  const byItem: Record<number, ItemShopifyState> = {};
  for (const [itemId, list] of grouped) byItem[itemId] = itemShopifyState(list);
  return { pushes: rows, byItem };
}
