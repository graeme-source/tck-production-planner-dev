/**
 * Wrap-to-Shopify — the pure rules (Graeme, 16 Oct 2026). Objectives B, C, F.
 *
 * "+N packs on each wrap tap" to the recipe's mapped Shopify variant, and −N
 * automatically when packs are taken back out of the freezer. Only for
 * recipes flagged shopify_push_on_wrap (migration 0202 — cinnamon buns).
 *
 * The ledger (shopify_wrap_pushes) is the safety net:
 *   1. CLAIM: one row per wrap event, keyed by a UNIQUE event key. A double
 *      tap or a replayed request finds the row already there and sends
 *      nothing new.
 *   2. SEND: only a row that wins the pending/failed → sending update is
 *      sent, so two retries at once can't both go.
 *   3. RECORD: sent (with Shopify's figure after the change), failed (with
 *      the error, shown on the wrapping screen with a Retry button), or
 *      skipped (this server is not allowed to write to Shopify —
 *      BLOCK_SHOPIFY_WRITES / staging — so nothing was changed, and we say
 *      so instead of pretending it worked).
 *   The event key is also Shopify's @idempotent key (supported from API
 *   2026-01, required from 2026-04), so even a retry after a send that DID
 *   land but timed out on the way back is ignored by Shopify.
 *
 * The Shopify location is PINNED in an app setting, never "the first one
 * Shopify lists" (the old adjustInventoryLevel's guess).
 *
 * Shopify mutation: inventoryAdjustQuantities on the "available" quantity —
 * on-hand moves by the same amount — reason "received" for a wrap and
 * "correction" for a take-back.
 */

export const WRAP_LOCATION_SETTING_KEY = "shopify_wrap_location_id";

export type WrapPushKind = "wrap" | "take_back";
export type WrapPushStatus = "pending" | "sending" | "sent" | "failed" | "skipped";

/** A client-made id for one tap (uuid-like). Keeps keys short and safe. */
export const CLIENT_EVENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** The ledger's unique key for one wrap event. */
export function wrapEventKey(kind: WrapPushKind, planItemId: number, clientEventId: string): string {
  if (!CLIENT_EVENT_ID.test(clientEventId)) throw new Error("Invalid event id");
  return `${kind}:${planItemId}:${clientEventId}`;
}

/** +N for a wrap, −N for a take-back; 0 / junk is refused. */
export function wrapPushDelta(kind: WrapPushKind, packs: number): number {
  const n = Math.trunc(Number(packs));
  if (!Number.isFinite(n) || n < 1) throw new Error("Packs must be a whole number above 0");
  return kind === "wrap" ? n : -n;
}

/** Shopify location setting → GID, or null if it isn't set / isn't a location. */
export function locationGid(setting: string | null | undefined): string | null {
  const v = (setting ?? "").trim();
  if (!v) return null;
  if (/^gid:\/\/shopify\/Location\/\d+$/.test(v)) return v;
  if (/^\d+$/.test(v)) return `gid://shopify/Location/${v}`;
  return null;
}

export function variantGid(variantId: string): string {
  return variantId.startsWith("gid://") ? variantId : `gid://shopify/ProductVariant/${variantId}`;
}

export const INVENTORY_ADJUST_MUTATION = `mutation TckWrapAdjust($input: InventoryAdjustQuantitiesInput!, $key: String!) {
  inventoryAdjustQuantities(input: $input) @idempotent(key: $key) {
    inventoryAdjustmentGroup { id changes { name delta quantityAfterChange } }
    userErrors { field message code }
  }
}`;

export interface AdjustRequestInput {
  eventKey: string;
  kind: WrapPushKind;
  delta: number;
  inventoryItemGid: string;
  locationGid: string;
}

/** The exact GraphQL request one ledger row sends. Pure, so it is tested. */
export function buildInventoryAdjustRequest(input: AdjustRequestInput): { query: string; variables: Record<string, unknown> } {
  if (!input.delta) throw new Error("Nothing to send");
  return {
    query: INVENTORY_ADJUST_MUTATION,
    variables: {
      key: input.eventKey,
      input: {
        name: "available",
        reason: input.kind === "wrap" ? "received" : "correction",
        // Shows in Shopify admin's inventory history: which app and which
        // wrap event made the change, so anyone can trace a figure back.
        referenceDocumentUri: `gid://tck-production-planner/WrapEvent/${encodeURIComponent(input.eventKey)}`,
        changes: [{ delta: input.delta, inventoryItemId: input.inventoryItemGid, locationId: input.locationGid }],
      },
    },
  };
}

export interface AdjustResponse {
  inventoryAdjustQuantities?: {
    inventoryAdjustmentGroup?: { id?: string; changes?: Array<{ name?: string; delta?: number; quantityAfterChange?: number | null }> } | null;
    userErrors?: Array<{ field?: string[] | null; message: string; code?: string | null }>;
  } | null;
}

/** Shopify's answer → sent (with the figure after) or an error to show. */
export function parseInventoryAdjustResponse(data: AdjustResponse): { ok: true; quantityAfter: number | null } | { ok: false; error: string } {
  const payload = data?.inventoryAdjustQuantities;
  if (!payload) return { ok: false, error: "Shopify returned no result" };
  const errors = payload.userErrors ?? [];
  if (errors.length > 0) return { ok: false, error: errors.map(e => e.code ? `${e.message} (${e.code})` : e.message).join("; ") };
  if (!payload.inventoryAdjustmentGroup) return { ok: false, error: "Shopify made no change" };
  const change = (payload.inventoryAdjustmentGroup.changes ?? []).find(c => c.name === "available");
  return { ok: true, quantityAfter: change?.quantityAfterChange ?? null };
}

/** Only a failed send is offered again. Sent is done; skipped means this
 *  server may not write; pending/sending are in flight (a 'sending' row left
 *  by a crash may have landed — check Shopify, don't resend blind). */
export function canRetry(status: WrapPushStatus): boolean {
  return status === "failed";
}

/** A 'sending' row older than this is reported as "unknown — check Shopify". */
export const STUCK_SENDING_MS = 2 * 60 * 1000;

export interface WrapPushRow {
  id: number;
  planItemId: number;
  kind: WrapPushKind;
  delta: number;
  status: WrapPushStatus;
  error: string | null;
  updatedAt: string | Date;
}

export type ItemShopifyState =
  | { state: "none" }
  | { state: "ok"; sentPacks: number }
  | { state: "sending"; packs: number }
  | { state: "failed"; failedIds: number[]; failedPacks: number; error: string | null; sentPacks: number }
  | { state: "skipped"; packs: number }
  | { state: "stuck"; ids: number[] };

/**
 * What the wrapping screen says for one recipe: "+8 sent to Shopify ✓",
 * "Shopify update failed — retry", "Not sent — Shopify writes are off on
 * this server", or "Sending…". Worst news wins.
 */
export function itemShopifyState(rows: readonly WrapPushRow[], now: number = Date.now()): ItemShopifyState {
  if (rows.length === 0) return { state: "none" };
  const sent = rows.filter(r => r.status === "sent").reduce((s, r) => s + r.delta, 0);
  const stuck = rows.filter(r => r.status === "sending" && now - new Date(r.updatedAt).getTime() > STUCK_SENDING_MS);
  if (stuck.length > 0) return { state: "stuck", ids: stuck.map(r => r.id) };
  const failed = rows.filter(r => r.status === "failed");
  if (failed.length > 0) {
    const latest = [...failed].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
    return { state: "failed", failedIds: failed.map(r => r.id), failedPacks: failed.reduce((s, r) => s + r.delta, 0), error: latest.error, sentPacks: sent };
  }
  const inFlight = rows.filter(r => r.status === "pending" || r.status === "sending");
  if (inFlight.length > 0) return { state: "sending", packs: inFlight.reduce((s, r) => s + r.delta, 0) };
  const skipped = rows.filter(r => r.status === "skipped");
  if (skipped.length > 0 && sent === 0) return { state: "skipped", packs: skipped.reduce((s, r) => s + r.delta, 0) };
  return { state: "ok", sentPacks: sent };
}
