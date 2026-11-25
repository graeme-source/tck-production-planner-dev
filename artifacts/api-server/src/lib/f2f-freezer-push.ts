/**
 * Freezer moves → the recipe's F2F product's stock in Shopify — the switch,
 * the ledger writes and the one Shopify call. The rules (which items, the
 * gate, the key, the request, the outcomes) are pure in
 * ./f2f-freezer-push-rules.ts; read that first.
 *
 * Flow for one move (one recipe):
 *   claimF2fPush   INSERT … ON CONFLICT (event_key) DO NOTHING — the claim.
 *                  The same move again finds its row and sends nothing.
 *   sendF2fPush    UPDATE … SET status='sending' WHERE status may be sent —
 *                  only one caller wins — then the Shopify call, then
 *                  sent / failed / skipped.
 *   retryF2fPush   failed rows (and untracked skips) only — managers.
 * Never throws for a Shopify problem: the row records it, the screen says
 * so, and the app's own stock move stands.
 */
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db, appSettingsTable, f2fFreezerPushesTable, usersTable } from "@workspace/db";
import {
  F2F_PUSH_SETTING_KEY, UNCONFIRMED_MESSAGE, WRITES_OFF_MESSAGE, buildF2fAdjustRequest, canRetryF2f, f2fEventKey, f2fPushDelta, f2fPushGate,
  f2fSendOutcome, isF2fPushOn, planF2fPushes,
  type F2fPushPlan, type F2fPushSource, type F2fPushStatus, type F2fSkipReason, type PushItem,
} from "./f2f-freezer-push-rules";
import { parseInventoryAdjustResponse, type AdjustResponse } from "./shopify-wrap-push-rules";
import { getWrapLocationSetting } from "./shopify-wrap-push";
import { getShopifyFreezerSyncEnabled } from "./inventory-sync";
import { ShopifyWritesBlockedError, getVariantInventoryItem, sendInventoryAdjust, shopifyWritesBlocked } from "../services/shopify";

// ── The switch ──────────────────────────────────────────────────────────────

export async function getF2fPushEnabled(): Promise<boolean> {
  try {
    const [row] = await db.select({ value: appSettingsTable.value }).from(appSettingsTable).where(eq(appSettingsTable.key, F2F_PUSH_SETTING_KEY));
    return isF2fPushOn(row?.value ?? null);
  } catch (err) {
    // Off is the safe answer: the move then works exactly as before.
    console.error("[f2f-freezer-push] couldn't read the switch, treating it as off:", err);
    return false;
  }
}

/** The F2F links dialog's "missing" list: core recipes with no F2F link. */
export async function unlinkedCoreRecipes(): Promise<string[]> {
  const r = await db.execute<{ name: string }>(sql`
    SELECT name FROM recipes WHERE archived_at IS NULL AND is_core_menu AND f2f_variant_id IS NULL ORDER BY name`);
  return r.rows.map(x => x.name.trim());
}

export async function f2fPushGateNow() {
  const [unlinkedCore, location, legacyFreezerSyncOn] = await Promise.all([
    unlinkedCoreRecipes(), getWrapLocationSetting(), getShopifyFreezerSyncEnabled(),
  ]);
  return { ...f2fPushGate({ unlinkedCore, locationSet: !!location, legacyFreezerSyncOn }), unlinkedCore };
}

/** Admin switch. Turning it on is refused (with every reason) until the gate passes. */
export async function setF2fPushEnabled(on: boolean, who: { id: number; name: string }): Promise<{ ok: true; enabled: boolean } | { ok: false; reasons: string[] }> {
  if (on) {
    const gate = await f2fPushGateNow();
    if (!gate.canTurnOn) return { ok: false, reasons: gate.reasons };
  }
  await db.insert(appSettingsTable).values({ key: F2F_PUSH_SETTING_KEY, value: on ? "true" : "false" })
    .onConflictDoUpdate({ target: appSettingsTable.key, set: { value: on ? "true" : "false", updatedAt: new Date() } });
  console.log(`[f2f-freezer-push] ${who.name} (user ${who.id}) switched F2F freezer → Shopify ${on ? "ON" : "OFF"}`);
  return { ok: true, enabled: on };
}

// ── Planning a move ─────────────────────────────────────────────────────────

export interface MoveItemIn { recipeId: number; packs: number; planItemId?: number | null }

/** What a move would send to Shopify (reads only). With the switch off the
 *  plan is empty and `enabled` is false. */
export async function planF2fMove(source: F2fPushSource, items: readonly MoveItemIn[]): Promise<F2fPushPlan> {
  const enabled = await getF2fPushEnabled();
  if (!enabled || !items.length) return planF2fPushes({ enabled, source, items: [] });
  const ids = [...new Set(items.map(i => i.recipeId))];
  const rows = await db.execute<{ id: number; name: string; f2f_variant_id: string | null; f2f_product_title: string | null; f2f_variant_title: string | null; shopify_push_on_wrap: boolean | null }>(sql`
    SELECT id, name, f2f_variant_id, f2f_product_title, f2f_variant_title, shopify_push_on_wrap FROM recipes
     WHERE id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`);
  const byId = new Map(rows.rows.map(r => [Number(r.id), r]));
  return planF2fPushes({
    enabled, source,
    items: items.flatMap(i => {
      const r = byId.get(i.recipeId);
      if (!r) return [];
      return [{
        recipeId: i.recipeId, recipeName: r.name.trim(), packs: i.packs, planItemId: i.planItemId ?? null,
        f2f: r.f2f_variant_id ? { variantId: r.f2f_variant_id, title: r.f2f_product_title ?? "F2F product", variantTitle: r.f2f_variant_title } : null,
        pushesOnWrap: r.shopify_push_on_wrap === true,
      }];
    }),
  });
}

// ── The ledger ──────────────────────────────────────────────────────────────

type Row = typeof f2fFreezerPushesTable.$inferSelect;

export interface F2fPushView {
  id: number; eventKey: string; source: F2fPushSource; recipeId: number; planId: number | null; planItemId: number | null;
  productTitle: string | null; variantTitle: string | null; delta: number; status: F2fPushStatus; skipReason: F2fSkipReason | null;
  error: string | null; note: string | null; attempts: number; quantityAfter: number | null; userName: string | null;
  createdAt: Date; updatedAt: Date; sentAt: Date | null; canRetry: boolean;
}

export function toView(r: Row): F2fPushView {
  const status = r.status as F2fPushStatus;
  const skipReason = (r.skipReason as F2fSkipReason | null) ?? null;
  return {
    id: r.id, eventKey: r.eventKey, source: r.source as F2fPushSource, recipeId: r.recipeId, planId: r.planId, planItemId: r.planItemId,
    productTitle: r.productTitle, variantTitle: r.variantTitle, delta: r.delta, status, skipReason, error: r.error, note: r.note,
    attempts: r.attempts, quantityAfter: r.quantityAfter, userName: r.userName,
    createdAt: r.createdAt, updatedAt: r.updatedAt, sentAt: r.sentAt, canRetry: canRetryF2f(status, skipReason),
  };
}

export async function userName(userId: number | null): Promise<string | null> {
  if (!userId) return null;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  return u?.name ?? null;
}

export interface ClaimInput {
  source: F2fPushSource;
  item: PushItem;
  clientEventId: string;
  planId?: number | null;
  userId: number | null;
  userName: string | null;
}

/** The claim. `isNew` false = this exact move was already recorded (a double
 *  tap / replay) — the caller must not move the stock again. */
export async function claimF2fPush(input: ClaimInput): Promise<{ row: Row; isNew: boolean }> {
  const eventKey = f2fEventKey(input.source, input.item.planItemId ?? input.item.recipeId, input.clientEventId);
  const inserted = await db.insert(f2fFreezerPushesTable).values({
    eventKey, source: input.source, recipeId: input.item.recipeId, planId: input.planId ?? null, planItemId: input.item.planItemId,
    variantId: input.item.f2f.variantId, productTitle: input.item.f2f.title, variantTitle: input.item.f2f.variantTitle,
    delta: f2fPushDelta(input.item.packs), status: "pending", userId: input.userId, userName: input.userName,
  }).onConflictDoNothing({ target: f2fFreezerPushesTable.eventKey }).returning();
  if (inserted[0]) return { row: inserted[0], isNew: true };
  const [existing] = await db.select().from(f2fFreezerPushesTable).where(eq(f2fFreezerPushesTable.eventKey, eventKey));
  return { row: existing!, isNew: false };
}

/** This exact move, if it was already recorded (read only). */
export async function findF2fPush(source: F2fPushSource, scopeId: number, clientEventId: string): Promise<F2fPushView | null> {
  const [row] = await db.select().from(f2fFreezerPushesTable).where(eq(f2fFreezerPushesTable.eventKey, f2fEventKey(source, scopeId, clientEventId)));
  return row ? toView(row) : null;
}

/** Drop a claim whose stock move then failed — nothing happened, so nothing
 *  may be sent. Only a row still pending (never sent) is removed. */
export async function releaseF2fClaim(id: number): Promise<void> {
  await db.delete(f2fFreezerPushesTable).where(and(eq(f2fFreezerPushesTable.id, id), eq(f2fFreezerPushesTable.status, "pending")));
}

/** After the stock move: send it (confirmed) or park it as failed for a
 *  manager to check and retry (the screen didn't show the confirm). */
export async function completeF2fClaim(id: number, confirmed: boolean): Promise<F2fPushView | null> {
  if (!confirmed) {
    const [row] = await db.update(f2fFreezerPushesTable)
      .set({ status: "failed", error: UNCONFIRMED_MESSAGE, updatedAt: new Date() })
      .where(and(eq(f2fFreezerPushesTable.id, id), eq(f2fFreezerPushesTable.status, "pending")))
      .returning();
    return row ? toView(row) : null;
  }
  return sendF2fPush(id);
}

/** What a freezer move tells the screen about Shopify (null = switched off). */
export interface F2fMoveResult {
  pushes: F2fPushView[];
  skipped: F2fPushPlan["skipped"];
  /** Pushes that couldn't even be RECORDED (database trouble) — said on screen. */
  errors: string[];
}

export const RECORD_FAILED_MESSAGE = "Couldn't record the Shopify update — the packs ARE in the freezer; tell a manager to add them to the F2F product in Shopify by hand.";

/** Record and send every pushed item of a move that has already happened.
 *  A repeat of the same move sends nothing new. Never throws. */
export async function pushF2fMove(input: { plan: F2fPushPlan; source: F2fPushSource; clientEventId: string; confirmed: boolean; planId?: number | null; userId: number | null }): Promise<F2fMoveResult> {
  const out: F2fMoveResult = { pushes: [], skipped: input.plan.skipped, errors: [] };
  if (!input.plan.enabled || !input.plan.push.length) return out;
  const name = await userName(input.userId).catch(() => null);
  for (const item of input.plan.push) {
    try {
      const { row, isNew } = await claimF2fPush({ source: input.source, item, clientEventId: input.clientEventId, planId: input.planId, userId: input.userId, userName: name });
      out.pushes.push(isNew ? (await completeF2fClaim(row.id, input.confirmed)) ?? toView(row) : toView(row));
    } catch (err) {
      console.error(`[f2f-freezer-push] couldn't record the push for recipe ${item.recipeId}:`, err);
      out.errors.push(`${item.recipeName}: ${RECORD_FAILED_MESSAGE}`);
    }
  }
  return out;
}

/** Send one ledger row if it may be sent. Only one caller wins the claim;
 *  everyone else gets the row as it stands. */
export async function sendF2fPush(id: number): Promise<F2fPushView | null> {
  const [claimed] = await db.update(f2fFreezerPushesTable)
    .set({ status: "sending", attempts: sql`${f2fFreezerPushesTable.attempts} + 1`, error: null, note: null, updatedAt: new Date() })
    .where(and(
      eq(f2fFreezerPushesTable.id, id),
      or(
        inArray(f2fFreezerPushesTable.status, ["pending", "failed"]),
        and(eq(f2fFreezerPushesTable.status, "skipped"), eq(f2fFreezerPushesTable.skipReason, "untracked")),
      ),
    ))
    .returning();
  if (!claimed) {
    const [row] = await db.select().from(f2fFreezerPushesTable).where(eq(f2fFreezerPushesTable.id, id));
    return row ? toView(row) : null;
  }

  const finish = async (status: F2fPushStatus, f: { error?: string | null; note?: string | null; skipReason?: F2fSkipReason | null; quantityAfter?: number | null; locationId?: string | null } = {}) => {
    const [row] = await db.update(f2fFreezerPushesTable).set({
      status, error: f.error ?? null, note: f.note ?? null, skipReason: f.skipReason ?? null, quantityAfter: f.quantityAfter ?? null,
      ...(f.locationId !== undefined ? { locationId: f.locationId } : {}),
      sentAt: status === "sent" ? new Date() : null, updatedAt: new Date(),
    }).where(eq(f2fFreezerPushesTable.id, id)).returning();
    if (status === "sent") console.log(`[f2f-freezer-push] +${claimed.delta} → ${claimed.productTitle} sent (push ${id}, ${claimed.source})`);
    else console.warn(`[f2f-freezer-push] push ${id} ${status}: ${f.error ?? ""}`);
    return toView(row!);
  };

  // Checked before anything else (even reads): this server may not write.
  if (shopifyWritesBlocked()) return finish("skipped", { skipReason: "writes_off", error: WRITES_OFF_MESSAGE });
  if (!claimed.variantId) return finish("failed", { error: "This recipe has no F2F product linked — link it, then retry." });
  const location = await getWrapLocationSetting();
  if (!location) return finish("failed", { error: "No Shopify location is chosen for wrapping yet — an admin sets it on a recipe's production route, then retry." });

  try {
    const item = await getVariantInventoryItem(claimed.variantId);
    if (!item) return finish("failed", { error: `Shopify doesn't know the F2F product (variant ${claimed.variantId}) — check the F2F link.`, locationId: location });
    const request = buildF2fAdjustRequest({ eventKey: claimed.eventKey, delta: claimed.delta, inventoryItemGid: item.inventoryItemGid, locationGid: location });
    let parsed: ReturnType<typeof parseInventoryAdjustResponse>;
    try {
      parsed = parseInventoryAdjustResponse(await sendInventoryAdjust<AdjustResponse>(request));
    } catch (err) {
      if (err instanceof ShopifyWritesBlockedError) throw err;
      // An untracked item Shopify won't take is a skip, not a failure.
      if (!item.tracked) parsed = { ok: false, error: err instanceof Error ? err.message : String(err) };
      else throw err;
    }
    const o = f2fSendOutcome(item.tracked, parsed);
    if (o.status === "sent") return finish("sent", { quantityAfter: o.quantityAfter, note: o.note, locationId: location });
    if (o.status === "skipped") return finish("skipped", { skipReason: o.skipReason, error: o.error, locationId: location });
    return finish("failed", { error: o.error, locationId: location });
  } catch (err) {
    if (err instanceof ShopifyWritesBlockedError) return finish("skipped", { skipReason: "writes_off", error: WRITES_OFF_MESSAGE, locationId: location });
    return finish("failed", { error: err instanceof Error ? err.message : String(err), locationId: location });
  }
}

export async function retryF2fPush(id: number): Promise<{ ok: true; row: F2fPushView } | { ok: false; status: number; error: string }> {
  const [row] = await db.select().from(f2fFreezerPushesTable).where(eq(f2fFreezerPushesTable.id, id));
  if (!row) return { ok: false, status: 404, error: "Not found" };
  if (!canRetryF2f(row.status as F2fPushStatus, (row.skipReason as F2fSkipReason | null) ?? null)) {
    return { ok: false, status: 409, error: `This update is ${row.status} — only a failed one can be retried.` };
  }
  const sent = await sendF2fPush(id);
  return sent ? { ok: true, row: sent } : { ok: false, status: 404, error: "Not found" };
}

/** Pushes that need someone: failed, untracked skips and ones stuck sending,
 *  newest first, with the recipe name. Plus the latest few that went. */
export async function listF2fPushes(limit = 50): Promise<{ open: Array<F2fPushView & { recipeName: string }>; recent: Array<F2fPushView & { recipeName: string }> }> {
  const names = async (rows: Row[]) => {
    const ids = [...new Set(rows.map(r => r.recipeId))];
    if (!ids.length) return new Map<number, string>();
    const r = await db.execute<{ id: number; name: string }>(sql`SELECT id, name FROM recipes WHERE id IN (${sql.join(ids.map(i => sql`${i}`), sql`, `)})`);
    return new Map(r.rows.map(x => [Number(x.id), x.name.trim()]));
  };
  const openRows = await db.select().from(f2fFreezerPushesTable)
    .where(or(
      eq(f2fFreezerPushesTable.status, "failed"),
      and(eq(f2fFreezerPushesTable.status, "skipped"), eq(f2fFreezerPushesTable.skipReason, "untracked")),
      and(inArray(f2fFreezerPushesTable.status, ["pending", "sending"]), sql`${f2fFreezerPushesTable.updatedAt} < NOW() - INTERVAL '2 minutes'`),
    ))
    .orderBy(desc(f2fFreezerPushesTable.createdAt)).limit(limit);
  const recentRows = await db.select().from(f2fFreezerPushesTable).orderBy(desc(f2fFreezerPushesTable.createdAt)).limit(20);
  const n = await names([...openRows, ...recentRows]);
  const withName = (r: Row) => ({ ...toView(r), recipeName: n.get(r.recipeId) ?? `Recipe ${r.recipeId}` });
  return { open: openRows.map(withName), recent: recentRows.map(withName) };
}
