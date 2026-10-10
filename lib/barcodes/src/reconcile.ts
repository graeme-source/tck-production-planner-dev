/**
 * Comparing our barcode for a variant with Shopify's — the rule behind the
 * one-time pull, the hourly check and the "Check Shopify now" button.
 * Shopify is only ever READ. Our database is the source of truth for
 * scanning: a barcode the app owns is never overwritten by a check — a
 * difference is LISTED ("Different in Shopify") for a person, whose only
 * action is "Use Shopify's". (Shopify's barcode also feeds Google Shopping
 * GTINs, which is why a difference is worth seeing.)
 *
 * Who owns a variant's barcode:
 *   - a variant LINKED to a recipe (lib links.ts) — set in the app.
 *   - a variant whose barcode was set in the app, even if since unlinked,
 *     so an app-set number is never lost to a check.
 *   - any other variant (sauces, desserts, F2F lines…) can't be edited in
 *     the app, so Shopify is its only source and our copy simply follows it —
 *     what the old manual "Sync from Shopify" did, now automatic.
 */
import { checkGtin, normaliseBarcode } from "./gtin";

export type PullOutcome =
  /** We had none; Shopify had one — ours filled from Shopify (pull). */
  | "filled"
  /** We have none; Shopify has one — left for a person (hourly check). */
  | "shopify-only"
  /** Same on both sides. */
  | "unchanged"
  /** Both set and different — listed, neither side changed. */
  | "conflict"
  /** Shopify has no barcode on this variant. */
  | "missing"
  /** The variant no longer exists in Shopify. */
  | "not-in-shopify"
  /** A retired product (identity.ts): never claims a barcode in our table. */
  | "retired"
  /** Not app-owned: our copy follows Shopify (changed this run). */
  | "followed"
  /** Not app-owned and already the same as Shopify. */
  | "followed-unchanged";

export interface PullInput {
  /** "pull" fills an empty barcode of ours from Shopify; "check" (hourly)
   *  only reports it. Neither ever overwrites a barcode we hold. */
  mode?: "pull" | "check";
  linked: boolean;
  /** Linked to an active recipe or an active Shopify product (identity.ts).
   *  Default true. */
  current?: boolean;
  /** Ours was set in the app (barcode_source = 'app'). */
  setInApp?: boolean;
  ours: string | null;
  /** null = the variant was not found in Shopify at all. */
  shopify: { barcode: string | null } | null;
}

export interface PullDecision {
  outcome: PullOutcome;
  /** The barcode to store as ours, when this run should change it
   *  (undefined = leave ours alone). */
  setOurs?: string | null;
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
    return { outcome: "not-in-shopify", invalid: isInvalid(ours) };
  }
  const theirs = val(input.shopify.barcode);
  if (input.current === false) {
    return ours == null ? { outcome: "retired", invalid: false } : { outcome: "retired", setOurs: null, invalid: false };
  }
  const appOwned = input.linked || !!input.setInApp;

  if (!appOwned) {
    if (ours === theirs) return { outcome: "followed-unchanged", invalid: isInvalid(theirs) };
    return { outcome: "followed", setOurs: theirs, invalid: isInvalid(theirs) };
  }

  if (ours === theirs) {
    if (ours == null) return { outcome: "missing", invalid: false };
    return { outcome: "unchanged", invalid: isInvalid(ours) };
  }
  if (ours == null) {
    return input.mode === "check"
      ? { outcome: "shopify-only", invalid: isInvalid(theirs) }
      : { outcome: "filled", setOurs: theirs, invalid: isInvalid(theirs) };
  }
  if (theirs == null) return { outcome: "missing", invalid: isInvalid(ours) };
  return { outcome: "conflict", invalid: isInvalid(ours) || isInvalid(theirs) };
}

export interface PullCounts {
  filled: number;
  shopifyOnly: number;
  unchanged: number;
  conflict: number;
  missing: number;
  notInShopify: number;
  retired: number;
  invalid: number;
  followed: number;
}

export function countOutcomes(decisions: Array<Pick<PullDecision, "outcome" | "invalid">>): PullCounts {
  const c: PullCounts = { filled: 0, shopifyOnly: 0, unchanged: 0, conflict: 0, missing: 0, notInShopify: 0, retired: 0, invalid: 0, followed: 0 };
  decisions.forEach(d => {
    if (d.invalid) c.invalid++;
    switch (d.outcome) {
      case "filled": c.filled++; break;
      case "shopify-only": c.shopifyOnly++; break;
      case "unchanged": c.unchanged++; break;
      case "conflict": c.conflict++; break;
      case "missing": c.missing++; break;
      case "not-in-shopify": c.notInShopify++; break;
      case "retired": c.retired++; break;
      case "followed": c.followed++; break;
      case "followed-unchanged": break;
    }
  });
  return c;
}

/** "Different in Shopify" on screen: Shopify had a barcode at the last check
 *  and it isn't ours (including Shopify having one where we have none).
 *  Informational — the one action is "Use Shopify's". */
export function isDifferentInShopify(row: { ours: string | null; shopifyBarcode: string | null; shopifyCheckedAt: unknown; notInShopify?: boolean }): boolean {
  if (row.shopifyCheckedAt == null || row.notInShopify) return false;
  const ours = val(row.ours);
  const theirs = val(row.shopifyBarcode);
  return ours !== theirs && theirs != null;
}

/** The one barcode a group of listings (same recipe, same kind) shares.
 *  `mixed` when they hold different numbers — the label then prints none
 *  and the recipe page asks for one number. Empty listings are ignored. */
export function groupBarcode(barcodes: Array<string | null | undefined>): { barcode: string | null; mixed: boolean } {
  const set = new Set(barcodes.map(val).filter((b): b is string => b != null));
  if (set.size === 0) return { barcode: null, mixed: false };
  if (set.size > 1) return { barcode: null, mixed: true };
  return { barcode: [...set][0], mixed: false };
}
