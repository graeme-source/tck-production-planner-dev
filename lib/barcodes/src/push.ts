/**
 * What happened when a barcode was sent to Shopify, in words people can act
 * on. Our database ALWAYS keeps the new barcode (the packing scanner reads
 * it straight away); this only decides whether Shopify is in step or the
 * change is "Not yet sent to Shopify — <reason>" with a Retry.
 */

export type PushAttempt =
  /** BLOCK_SHOPIFY_WRITES / staging — the server refused to write. */
  | { kind: "blocked" }
  /** The app's Shopify connection lacks a scope it needs. */
  | { kind: "missing-scope"; scopes: string[] }
  /** Shopify answered, with userErrors and/or the saved variants. */
  | { kind: "answered"; userErrors: string[]; saved: Array<{ variantId: string; barcode: string | null }> }
  /** Network / HTTP / GraphQL failure. */
  | { kind: "error"; message: string };

export type PushResult =
  | { state: "sent" }
  | { state: "pending"; reason: string; result: "blocked" | "failed" };

export const SHOPIFY_WRITE_SCOPE = "write_products";

export function decidePush(attempt: PushAttempt, wanted: { variantId: string; barcode: string }): PushResult {
  switch (attempt.kind) {
    case "blocked":
      return { state: "pending", result: "blocked", reason: "Shopify changes are switched off on this server (BLOCK_SHOPIFY_WRITES)" };
    case "missing-scope":
      return { state: "pending", result: "blocked", reason: `the app isn't allowed to change Shopify products yet (needs the ${attempt.scopes.join(", ")} permission)` };
    case "error":
      return { state: "pending", result: "failed", reason: `couldn't reach Shopify (${trim(attempt.message)})` };
    case "answered": {
      if (attempt.userErrors.length) {
        return { state: "pending", result: "failed", reason: `Shopify refused it: ${trim(attempt.userErrors.join("; "))}` };
      }
      const saved = attempt.saved.find(s => s.variantId === wanted.variantId);
      if (!saved || (saved.barcode ?? "").trim() !== wanted.barcode) {
        return { state: "pending", result: "failed", reason: "Shopify didn't confirm the new barcode" };
      }
      return { state: "sent" };
    }
  }
}

/** Missing scopes, given the scopes the app has. */
export function missingScopes(have: string[], need: readonly string[] = [SHOPIFY_WRITE_SCOPE]): string[] {
  return need.filter(s => !have.includes(s));
}

function trim(s: string): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > 200 ? `${one.slice(0, 197)}…` : one;
}
