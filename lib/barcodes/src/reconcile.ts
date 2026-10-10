/**
 * Comparing our barcode for a variant with Shopify's — the rule behind the
 * one-time pull, the hourly check and the "Check Shopify now" button. It
 * never overwrites a barcode the app owns: a difference is LISTED for a
 * person to decide ("Use Shopify's" / "Send ours to Shopify").
 *
 * Who owns a variant's barcode:
 *   - a variant LINKED to a recipe (lib links.ts) is set in the app and sent
 *     to Shopify; the app is the source.
 *   - any other variant (sauces, desserts, F2F lines…) can't be edited in
 *     the app, so Shopify is its only source and our copy simply follows it —
 *     what the old manual "Sync from Shopify" did, now automatic.
 *   - a variant with a push still waiting is treated as app-owned even if it
 *     has since been unlinked, so an unsent change is never lost.
 */
import { checkGtin, normaliseBarcode } from "./gtin";

export type PullOutcome =
  /** We had none; Shopify had one — ours filled from Shopify. */
  | "filled"
  /** Same on both sides. */
  | "unchanged"
  /** Both set and different — listed, neither side changed. */
  | "conflict"
  /** Ours was changed in the app and is waiting to be sent to Shopify. */
  | "pending"
  /** Shopify has no barcode on this variant. */
  | "missing"
  /** The variant no longer exists in Shopify. */
  | "not-in-shopify"
  /** Not linked to a recipe: our copy follows Shopify (changed this run). */
  | "followed"
  /** Not linked to a recipe and already the same as Shopify. */
  | "followed-unchanged";

export interface PullInput {
  linked: boolean;
  ours: string | null;
  pushPending: boolean;
  /** null = the variant was not found in Shopify at all. */
  shopify: { barcode: string | null } | null;
}

export interface PullDecision {
  outcome: PullOutcome;
  /** The barcode to store as ours, when this run should change it
   *  (undefined = leave ours alone). */
  setOurs?: string | null;
  /** True when a waiting push can be cleared (Shopify now matches ours). */
  clearPending: boolean;
  /** The barcode this decision is about fails the GTIN check digit. Still
   *  stored — flagged for a person to look at. */
  invalid: boolean;
}

const val = (s: string | null | undefined): string | null => {
  const n = normaliseBarcode(s);
  return n === "" ? null : n;
};

const isInvalid = (s: string | null): boolean => s != null && !checkGtin(s).ok;

export function decidePull(input: PullInput): PullDecision {
  const ours = val(input.ours);
  if (input.shopify == null) {
    return { outcome: "not-in-shopify", clearPending: false, invalid: isInvalid(ours) };
  }
  const theirs = val(input.shopify.barcode);
  const appOwned = input.linked || input.pushPending;

  if (!appOwned) {
    if (ours === theirs) return { outcome: "followed-unchanged", clearPending: false, invalid: isInvalid(theirs) };
    return { outcome: "followed", setOurs: theirs, clearPending: false, invalid: isInvalid(theirs) };
  }

  if (ours === theirs) {
    if (ours == null) return { outcome: "missing", clearPending: false, invalid: false };
    return { outcome: "unchanged", clearPending: input.pushPending, invalid: isInvalid(ours) };
  }
  if (input.pushPending) return { outcome: "pending", clearPending: false, invalid: isInvalid(ours) };
  if (ours == null) return { outcome: "filled", setOurs: theirs, clearPending: false, invalid: isInvalid(theirs) };
  if (theirs == null) return { outcome: "missing", clearPending: false, invalid: isInvalid(ours) };
  return { outcome: "conflict", clearPending: false, invalid: isInvalid(ours) || isInvalid(theirs) };
}

export interface PullCounts {
  filled: number;
  unchanged: number;
  conflict: number;
  pending: number;
  missing: number;
  notInShopify: number;
  invalid: number;
  followed: number;
}

export function countOutcomes(decisions: Array<Pick<PullDecision, "outcome" | "invalid">>): PullCounts {
  const c: PullCounts = { filled: 0, unchanged: 0, conflict: 0, pending: 0, missing: 0, notInShopify: 0, invalid: 0, followed: 0 };
  decisions.forEach(d => {
    if (d.invalid) c.invalid++;
    switch (d.outcome) {
      case "filled": c.filled++; break;
      case "unchanged": c.unchanged++; break;
      case "conflict": c.conflict++; break;
      case "pending": c.pending++; break;
      case "missing": c.missing++; break;
      case "not-in-shopify": c.notInShopify++; break;
      case "followed": c.followed++; break;
      case "followed-unchanged": break;
    }
  });
  return c;
}

/** "Different in Shopify" on screen: an app-owned variant whose barcode
 *  differs from the one Shopify had at the last check, with no push of ours
 *  waiting. (A waiting push shows as "Not yet sent to Shopify" instead.) */
export function isDifferentInShopify(row: { ours: string | null; shopifyBarcode: string | null; shopifyCheckedAt: unknown; pushPending: boolean; notInShopify?: boolean }): boolean {
  if (row.pushPending || row.shopifyCheckedAt == null || row.notInShopify) return false;
  const ours = val(row.ours);
  const theirs = val(row.shopifyBarcode);
  return ours !== theirs && ours != null && theirs != null;
}
