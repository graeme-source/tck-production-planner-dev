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

/** True when outbound real-world side-effects (Shopify writes, sending
 *  emails, fulfilling orders, adjusting inventory) should be suppressed
 *  and replaced with a console log. Staging only. Development is left
 *  alone because devs may deliberately be testing the real integration
 *  against their own Shopify dev store. */
export function shouldSkipSideEffect(): boolean {
  return isStaging();
}

/** Helper for logging suppressed side-effects in a consistent format. */
export function logSkippedSideEffect(operation: string, details: Record<string, unknown> = {}): void {
  console.log(`[staging] SKIPPED ${operation}`, details);
}
