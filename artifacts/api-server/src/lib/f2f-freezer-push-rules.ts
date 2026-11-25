/**
 * Freezer moves → the recipe's F2F product's stock in Shopify — the pure
 * rules (Graeme, 25 Nov 2026). Objective C. The ledger writes and the one
 * Shopify call are in ./f2f-freezer-push.ts.
 *
 * Wherever packs go into the freezer, the same packs are added (+N) to the
 * recipe's F2F variant's on-hand in Shopify, on top of the app's own freezer
 * stock:
 *   wrap_freezer   the wrapping station's "Product Freezer" (instead of the
 *                  fridge) — POST /production-plans/:id/items/:itemId/freezer
 *   wonky          the Wonky Rack transfer — POST /production-plans/:id/wonky-to-freezer
 *                  (wonky packs go onto the SAME F2F product)
 *   closing_check  the closing fridge check — POST /checklists/closing-fridge-freeze
 *
 * Switched OFF until every core recipe has its F2F product (the gate below,
 * checked when an admin turns it on). With it off nothing here runs and the
 * moves behave exactly as before.
 *
 * The screen shows what will go to Shopify and the person confirms first
 * ("These will be added to Shopify: …"); recipes with no F2F product push
 * nothing and are named ("No F2F product — add these in Shopify by hand").
 *
 * The ledger (f2f_freezer_pushes, migration 0400) is the safety net, as for
 * the wrap-to-Shopify pushes (shopify-wrap-push-rules.ts): one row per move
 * per recipe with a UNIQUE event key that is also Shopify's @idempotent key,
 * so a double tap, a replayed request or a retry can never count twice; the
 * app's stock move is never undone by a Shopify problem — the row says what
 * went wrong and managers get Retry.
 */
import { CLIENT_EVENT_ID, INVENTORY_ADJUST_MUTATION, type AdjustResponse } from "./shopify-wrap-push-rules";

export { CLIENT_EVENT_ID };
export type { AdjustResponse };

export const F2F_PUSH_SETTING_KEY = "feature_f2f_freezer_shopify_push";

/** Opt-in: only the stored value "true" switches it on. */
export function isF2fPushOn(value: string | null | undefined): boolean {
  return value === "true";
}

export type F2fPushSource = "wrap_freezer" | "wonky" | "closing_check";
export type F2fPushStatus = "pending" | "sending" | "sent" | "failed" | "skipped";
export type F2fSkipReason = "writes_off" | "untracked";

export const F2F_SOURCE_LABEL: Record<F2fPushSource, string> = {
  wrap_freezer: "Wrapping → Product Freezer",
  wonky: "Wonky Rack → freezer",
  closing_check: "Closing fridge check → freezer",
};

/**
 * The ledger's unique key for one recipe in one move. `scopeId` is the plan
 * item (wrapping, Wonky Rack) or the recipe (closing check); `clientEventId`
 * is the screen's id for the tap, so the same tap sent twice is one move.
 */
export function f2fEventKey(source: F2fPushSource, scopeId: number, clientEventId: string): string {
  if (!CLIENT_EVENT_ID.test(clientEventId)) throw new Error("Invalid event id");
  if (!Number.isInteger(scopeId) || scopeId <= 0) throw new Error("Invalid id");
  return `f2f:${source}:${scopeId}:${clientEventId}`;
}

/** +N packs; 0 / junk is refused. */
export function f2fPushDelta(packs: number): number {
  const n = Math.trunc(Number(packs));
  if (!Number.isFinite(n) || n < 1) throw new Error("Packs must be a whole number above 0");
  return n;
}

export interface F2fLink { variantId: string; title: string; variantTitle: string | null }

export interface PlanItemIn {
  recipeId: number;
  recipeName: string;
  packs: number;
  planItemId?: number | null;
  f2f: F2fLink | null;
  /** The recipe already pushes every wrap to its own Shopify product
   *  (recipes.shopify_push_on_wrap — cinnamon buns). */
  pushesOnWrap: boolean;
}

export interface PushItem { recipeId: number; recipeName: string; packs: number; planItemId: number | null; f2f: F2fLink; line: string }
export interface SkipItem { recipeId: number; recipeName: string; packs: number; planItemId: number | null; reason: "no_f2f" | "own_push"; line: string }

export interface F2fPushPlan {
  enabled: boolean;
  push: PushItem[];
  skipped: SkipItem[];
  /** "These will be added to Shopify:" — shown when `push` isn't empty. */
  heading: string;
  /** "No F2F product — add these in Shopify by hand:" — when any are no_f2f. */
  byHandHeading: string;
}

export const PUSH_HEADING = "These will be added to Shopify:";
export const BY_HAND_HEADING = "No F2F product — add these in Shopify by hand:";

const packsWord = (n: number) => `${n} pack${n === 1 ? "" : "s"}`;
const productName = (f: F2fLink) => (f.variantTitle && !/^default title$/i.test(f.variantTitle) ? `${f.title} · ${f.variantTitle}` : f.title);

/**
 * Which items go to Shopify and which don't. With the switch off: nothing,
 * either way (the move works exactly as before). A wrap into the freezer for
 * a recipe that already pushes every wrap to its own product is left alone
 * (it would count twice).
 */
export function planF2fPushes(input: { enabled: boolean; source: F2fPushSource; items: readonly PlanItemIn[] }): F2fPushPlan {
  const plan: F2fPushPlan = { enabled: input.enabled, push: [], skipped: [], heading: PUSH_HEADING, byHandHeading: BY_HAND_HEADING };
  if (!input.enabled) return plan;
  for (const it of input.items) {
    const packs = Math.trunc(Number(it.packs));
    if (!Number.isFinite(packs) || packs < 1) continue;
    const base = { recipeId: it.recipeId, recipeName: it.recipeName, packs, planItemId: it.planItemId ?? null };
    if (input.source === "wrap_freezer" && it.pushesOnWrap) {
      plan.skipped.push({ ...base, reason: "own_push", line: `${it.recipeName}: ${packsWord(packs)} — sent to its own Shopify product on wrap, as before` });
    } else if (!it.f2f) {
      plan.skipped.push({ ...base, reason: "no_f2f", line: `${it.recipeName}: ${packsWord(packs)}` });
    } else {
      plan.push.push({ ...base, f2f: it.f2f, line: `+${packsWord(packs)} → ${productName(it.f2f)}` });
    }
  }
  return plan;
}

/** Does the screen need to ask before the move? Only when something would
 *  actually be added to Shopify. */
export function needsConfirm(plan: F2fPushPlan): boolean {
  return plan.enabled && plan.push.length > 0;
}

export interface GateInput {
  /** Core recipes (not archived, on the core menu) with no F2F link — the
   *  F2F links dialog's "missing" list. */
  unlinkedCore: readonly string[];
  /** A Shopify location is pinned for wrapping (shopify_wrap_location_id). */
  locationSet: boolean;
  /** The old wrapping-complete → Shopify freezer upload (stock.ts
   *  shopify-freezer-sync-config) is on: it adds freezer packs to the MAIN
   *  product, so with both on the same packs would be in Shopify twice. */
  legacyFreezerSyncOn: boolean;
}

/** May an admin switch the F2F pushes on? Every reason is plain words. */
export function f2fPushGate(i: GateInput): { canTurnOn: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (i.unlinkedCore.length) {
    reasons.push(`${i.unlinkedCore.length} core recipe${i.unlinkedCore.length === 1 ? " has" : "s have"} no F2F product yet: ${[...i.unlinkedCore].sort((a, b) => a.localeCompare(b)).join(", ")}.`);
  }
  if (!i.locationSet) reasons.push("No Shopify location is chosen for wrapping yet (an admin sets it on a recipe's production route).");
  if (i.legacyFreezerSyncOn) reasons.push("The old \"wrapping complete → Shopify freezer stock\" upload is on — switch it off first, or the same packs would be added twice.");
  return { canTurnOn: reasons.length === 0, reasons };
}

/** The exact Shopify request one ledger row sends. Pure, so it is tested. */
export function buildF2fAdjustRequest(input: { eventKey: string; delta: number; inventoryItemGid: string; locationGid: string }): { query: string; variables: Record<string, unknown> } {
  if (!input.delta) throw new Error("Nothing to send");
  return {
    query: INVENTORY_ADJUST_MUTATION,
    variables: {
      key: input.eventKey,
      input: {
        name: "available",
        reason: "received",
        // Shopify admin's inventory history says which app and which move.
        referenceDocumentUri: `gid://tck-production-planner/F2fFreezerMove/${encodeURIComponent(input.eventKey)}`,
        changes: [{ delta: input.delta, inventoryItemId: input.inventoryItemGid, locationId: input.locationGid }],
      },
    },
  };
}

export const WRITES_OFF_MESSAGE = "Not sent — Shopify writes are switched off on this server, so Shopify was not changed.";
export const UNCONFIRMED_MESSAGE = "Not sent — this screen didn't show the Shopify confirmation (an old screen? reload it). Check the packs, then Retry.";
export const UNTRACKED_NOTE = "Shopify isn't tracking stock for this product, so the site won't use this number until tracking is switched on in Shopify.";

export type SendOutcome =
  | { status: "sent"; quantityAfter: number | null; note: string | null }
  | { status: "failed"; error: string }
  | { status: "skipped"; skipReason: F2fSkipReason; error: string };

/**
 * After Shopify answers. The push is sent even when the variant isn't
 * tracking stock (some test products are tracked, some aren't): if Shopify
 * takes it, it's sent (with a note); if Shopify refuses an untracked one,
 * it's reported as SKIPPED, not failed — nothing is wrong with the move.
 */
export function f2fSendOutcome(tracked: boolean, parsed: { ok: true; quantityAfter: number | null } | { ok: false; error: string }): SendOutcome {
  if (parsed.ok) return { status: "sent", quantityAfter: parsed.quantityAfter, note: tracked ? null : UNTRACKED_NOTE };
  if (!tracked) return { status: "skipped", skipReason: "untracked", error: `Skipped — Shopify isn't tracking stock for this product (${parsed.error}).` };
  return { status: "failed", error: parsed.error };
}

/** Failed rows can be retried; so can untracked skips (after tracking is
 *  switched on). Sent is done; writes-off means this server may not write;
 *  pending/sending are in flight. */
export function canRetryF2f(status: F2fPushStatus, skipReason: F2fSkipReason | null): boolean {
  return status === "failed" || (status === "skipped" && skipReason === "untracked");
}

export interface PushRowLite { status: F2fPushStatus; delta: number; productTitle: string | null; error: string | null; skipReason: F2fSkipReason | null; note: string | null }

/** One line per ledger row for the screen after a move. */
export function f2fRowText(r: PushRowLite): { tone: "ok" | "bad" | "off" | "busy"; text: string } {
  const what = `+${r.delta} → ${r.productTitle ?? "the F2F product"}`;
  switch (r.status) {
    case "sent": return { tone: "ok", text: `${what} in Shopify ✓${r.note ? ` (${r.note})` : ""}` };
    case "failed": return { tone: "bad", text: `${what}: Shopify update failed — ${r.error ?? "unknown error"}. A manager can retry it.` };
    case "skipped": return { tone: "off", text: r.skipReason === "untracked" ? `${what}: ${r.error ?? "skipped — not tracked in Shopify"}` : `${what}: ${WRITES_OFF_MESSAGE}` };
    default: return { tone: "busy", text: `${what}: sending…` };
  }
}
