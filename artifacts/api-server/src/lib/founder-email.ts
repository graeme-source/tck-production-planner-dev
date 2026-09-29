/**
 * The founder's account — the one identity some decisions belong to alone
 * (an admin is not the founder). The value and the exact-match rule now
 * live in @workspace/feature-registry (founder.ts) so the screen uses the
 * very same check; this file keeps the old import path working.
 */
export { FOUNDER_EMAIL, isFounderEmail } from "@workspace/feature-registry";
