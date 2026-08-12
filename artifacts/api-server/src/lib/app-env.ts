/**
 * Environment awareness for the api-server.
 *
 * Every Railway environment sets APP_ENV in its env vars:
 *   APP_ENV=production   → real live kitchen app, all side-effects enabled
 *   APP_ENV=staging      → clone of production used for smoke-testing
 *                          deploys; outbound side-effects are NO-OPs so
 *                          staging never writes to Shopify / emails staff
 *                          / fulfils real orders.
 *
 * Any new outbound side-effect MUST call `shouldSkipSideEffect()` and
 * either log-and-skip or substitute a dry-run behaviour when it returns
 * true. The goal: running the full app against the production database
 * snapshot on staging must never change anything in the real world.
 */

export type AppEnv = "production" | "staging" | "development";

export function appEnv(): AppEnv {
  const raw = (process.env["APP_ENV"] ?? "").toLowerCase();
  if (raw === "production") return "production";
  if (raw === "staging") return "staging";
  // Default for local dev and anything unrecognised: treat as development
  return "development";
}

export function isProduction(): boolean {
  return appEnv() === "production";
}

export function isStaging(): boolean {
  return appEnv() === "staging";
}

export function isDevelopment(): boolean {
  return appEnv() === "development";
}

/** Opt-in kill switch for a machine that talks to the REAL Shopify store.
 *
 *  Local dev points at the live store with live credentials, and APP_ENV is
 *  unset locally, so nothing otherwise stops a stray click fulfilling a real
 *  customer's order or emailing them. Setting BLOCK_SHOPIFY_WRITES=true in a
 *  local .env makes every Shopify write and outbound email a logged no-op
 *  while leaving READS — and the APC courier integration — working normally,
 *  so label booking can be exercised end to end without shipping anything.
 *
 *  Deliberately opt-IN: an environment that does not set it behaves exactly
 *  as before, so this can never silently disable fulfilment in production. */
export function blockShopifyWrites(): boolean {
  return (process.env["BLOCK_SHOPIFY_WRITES"] ?? "").toLowerCase() === "true";
}

/** True when outbound real-world side-effects (Shopify writes, sending
 *  emails, fulfilling orders, adjusting inventory) should be suppressed
 *  and replaced with a console log. Staging always; anywhere that has
 *  explicitly set BLOCK_SHOPIFY_WRITES. Development is otherwise left alone
 *  because devs may deliberately be testing the real integration. */
export function shouldSkipSideEffect(): boolean {
  return isStaging() || blockShopifyWrites();
}

/** Helper for logging suppressed side-effects in a consistent format. */
export function logSkippedSideEffect(operation: string, details: Record<string, unknown> = {}): void {
  console.log(`[staging] SKIPPED ${operation}`, details);
}
