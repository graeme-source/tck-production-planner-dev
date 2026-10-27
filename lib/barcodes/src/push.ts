/**
 * App ⇄ Shopify barcode sync — the pure rules (Graeme, 2026-10-12:
 * "a single source of truth, but also the ability to set it from the product
 * labels page and push it two ways"). Objectives A and F.
 *
 * Our table (sku_barcodes) stays the single source of truth. These rules
 * decide, per Shopify variant, whether a barcode saved in the app is SENT to
 * Shopify, and whether one Shopify has is ADOPTED by the app:
 *
 *   PUSH (app → Shopify), after every save in the app:
 *     - the Calzone Club Special is never written (Graeme switches it by
 *       hand the day before each new special) — "Managed by hand in Shopify";
 *     - an ARCHIVED Shopify product is never written (drafts are fine);
 *     - Shopify's barcode is never blanked — a variant with none of ours is
 *       left alone;
 *     - the same number already in Shopify → nothing to send;
 *     - Shopify blank, or holding the number WE had before this change (or
 *       last sent) → send;
 *     - Shopify holding some OTHER number → a disagreement: neither side is
 *       changed until a person picks "Use Shopify's" or "Send ours to
 *       Shopify" (force);
 *     - writes switched off on this server (BLOCK_SHOPIFY_WRITES / staging)
 *       or the Shopify connection lacking permission → "waiting to send":
 *       the app's value is saved regardless; it is sent later.
 *
 *   ADOPT (Shopify → app) is decidePull in reconcile.ts.
 */
import { gtinKey } from "./set";
import { normaliseBarcode } from "./gtin";

export type PushOutcome =
  /** Send ours to this variant now. */
  | "send"
  /** Shopify already has our number. */
  | "already"
  /** Shopify has a different number that isn't ours — listed, nothing sent. */
  | "conflict"
  /** The Shopify product is archived — never written. */
  | "skip-archived"
  /** The Calzone Club Special — managed by hand in Shopify, never written. */
  | "skip-club-special"
  /** The variant isn't in Shopify. */
  | "not-in-shopify"
  /** We hold no barcode — Shopify's is never blanked. */
  | "nothing"
  /** It would be sent, but writes can't go from this server right now. */
  | "waiting";

export interface PushInput {
  /** The barcode the app holds for this variant now. */
  ours: string | null;
  /** Live from Shopify; null = the variant doesn't exist there. */
  shopify: { barcode: string | null; status: string | null } | null;
  /** The Calzone Club Special's listing. */
  clubSpecial: boolean;
  /** Numbers in Shopify we may replace: ours before this change, the one we
   *  last sent. Anything else in Shopify is a person's — a disagreement. */
  replaceable?: Array<string | null | undefined>;
  /** A person pressed "Send ours to Shopify" / the bulk sync after its
   *  preview — replace whatever Shopify has. */
  force?: boolean;
  /** Why writes can't go from this server (switched off, missing
   *  permission); null/undefined = they can. */
  blocked?: string | null;
}

export interface PushDecision {
  outcome: PushOutcome;
  /** For people: why this outcome. */
  reason: string;
}

const val = (s: string | null | undefined): string | null => {
  const n = normaliseBarcode(s);
  return n === "" ? null : n;
};

const same = (a: string | null, b: string | null) => a != null && b != null && gtinKey(a) === gtinKey(b);

export const MANAGED_BY_HAND = "Managed by hand in Shopify";

export function decidePush(input: PushInput): PushDecision {
  if (input.clubSpecial) return { outcome: "skip-club-special", reason: MANAGED_BY_HAND };
  if (input.shopify == null) return { outcome: "not-in-shopify", reason: "This listing isn't in Shopify" };
  if ((input.shopify.status ?? "").toLowerCase() === "archived") {
    return { outcome: "skip-archived", reason: "Archived in Shopify — archived products are never changed" };
  }
  const ours = val(input.ours);
  const theirs = val(input.shopify.barcode);
  if (ours == null) return { outcome: "nothing", reason: "No barcode in the app — Shopify's is left as it is" };
  if (same(ours, theirs)) return { outcome: "already", reason: "Shopify already has this barcode" };
  if (theirs != null && !input.force) {
    const mayReplace = (input.replaceable ?? []).map(val).some(r => same(r, theirs));
    if (!mayReplace) return { outcome: "conflict", reason: `Shopify has a different barcode (${theirs}) — pick which one is right` };
  }
  if (input.blocked) return { outcome: "waiting", reason: input.blocked };
  return { outcome: "send", reason: theirs ? `replaces ${theirs} in Shopify` : "Shopify had none" };
}

/** What the card shows for a variant's last push. */
export type PushState = "sending" | "sent" | "waiting" | "failed" | "conflict" | "skipped";

/** The stored state a decision leaves (before a send resolves). */
export function stateFor(outcome: PushOutcome): PushState | null {
  switch (outcome) {
    case "send": return "sending";
    case "already": return "sent";
    case "conflict": return "conflict";
    case "waiting": return "waiting";
    case "skip-archived":
    case "skip-club-special":
    case "not-in-shopify": return "skipped";
    case "nothing": return null;
  }
}

// ── The one-time preview / bulk sync of existing differences ───────────────

export type SyncAction =
  /** Ours would replace a different number in Shopify. */
  | "overwrite"
  /** Shopify has none; ours would be filled in. */
  | "fill"
  /** We have none; Shopify's would be adopted. */
  | "adopt"
  /** Same both sides. */
  | "same"
  /** Not touched: Club Special, archived, gone from Shopify, retired, or
   *  neither side has one. */
  | "skip";

export interface SyncInput {
  ours: string | null;
  shopify: { barcode: string | null; status: string | null } | null;
  clubSpecial: boolean;
  /** Ours is the app's to send (linked to a recipe, or set by a person). */
  appOwned: boolean;
  /** Current product (identity.ts) — retired products never claim one. */
  current: boolean;
  /** A person cleared ours on purpose (a barcode moved away) — never
   *  adopted back from Shopify. */
  clearedByPerson?: boolean;
  /** Shopify's number is another current product's in our table. */
  heldElsewhere?: boolean;
}

export function decideSync(i: SyncInput): { action: SyncAction; reason: string } {
  if (i.clubSpecial) return { action: "skip", reason: MANAGED_BY_HAND };
  if (i.shopify == null) return { action: "skip", reason: "Not in Shopify" };
  if (!i.current) return { action: "skip", reason: "Old (retired) product" };
  const ours = val(i.ours);
  const theirs = val(i.shopify.barcode);
  const archived = (i.shopify.status ?? "").toLowerCase() === "archived";
  if (same(ours, theirs)) return { action: "same", reason: "Same both sides" };
  if (ours == null) {
    if (theirs == null) return { action: "skip", reason: "Neither has a barcode" };
    if (i.clearedByPerson) return { action: "skip", reason: "Cleared in the app on purpose" };
    if (i.heldElsewhere) return { action: "skip", reason: "Shopify's number belongs to another product here" };
    return { action: "adopt", reason: "Shopify's would be adopted" };
  }
  if (!i.appOwned) return { action: "skip", reason: "Follows Shopify (not set in the app)" };
  if (archived) return { action: "skip", reason: "Archived in Shopify — never changed" };
  return theirs == null ? { action: "fill", reason: "Shopify has none" } : { action: "overwrite", reason: `Shopify's ${theirs} would be replaced` };
}

export interface SyncCounts { overwrite: number; fill: number; adopt: number; same: number; skip: number }

export function countSync(actions: SyncAction[]): SyncCounts {
  const c: SyncCounts = { overwrite: 0, fill: 0, adopt: 0, same: 0, skip: 0 };
  for (const a of actions) c[a]++;
  return c;
}
