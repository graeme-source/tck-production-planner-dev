import { featureByKey } from "./registry";

/**
 * The founder's account, and the rules for "The Business" (Graeme,
 * 2026-09-29).
 *
 * The Business is the founder's own area. Two of its pages — Business
 * Numbers and Sales & Marketing — can now be handed to one named person
 * (Tommy first) as a feature grant. The rest (P&L, Schedule, Contracts,
 * Fix queue) stay his alone.
 *
 * These features are different from every other grant in one way: being
 * an admin does NOT open them. Admins get everything else in the app, but
 * the business's revenue and marketing numbers are the founder's to share,
 * so the only ways in are "you are the founder" or "the founder granted it
 * to you". And only the founder can grant or remove them — otherwise any
 * admin could hand themselves the numbers.
 *
 * Pure, no I/O: the server (middleware/founder-area-access.ts, routes/
 * features.ts) and the screen (use-founder-area.ts, the grants screen)
 * import the same functions, so they can't disagree.
 */

export const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";

/** EXACT match. The email index is case-sensitive and admins can edit
 *  emails, so a case-insensitive check would let an admin give another
 *  account "GRAEME@…" and pass as the founder. A missing email is never
 *  the founder. */
export function isFounderEmail(email: string | null | undefined): boolean {
  return email === FOUNDER_EMAIL;
}

/** Feature keys of the grantable founder pages. NEVER rename — grants
 *  are stored against them. */
export const FOUNDER_FEATURES = {
  numbers: "founder.numbers",
  sales: "founder.sales",
  /** Approve marketing emails (Graeme, 2026-09-30) — not a tab: an ability
   *  inside Sales & Marketing. Founder, or someone he grants it to. */
  approveEmails: "marketing.approve_emails",
  /** Print pack back labels from the wrapping station (Graeme, 2026-10-12)
   *  — his own while he tests it; grantable later without code changes. */
  printBackLabels: "labels.print_back",
} as const;

export type FounderFeatureKey = (typeof FOUNDER_FEATURES)[keyof typeof FOUNDER_FEATURES];

/** Is this one of the founder-only features (admin role does not count)? */
export function isFounderOnlyFeature(featureKey: string): boolean {
  return featureByKey(featureKey)?.founderOnly === true;
}

/**
 * May this person open a founder-only feature?
 * Founder, or an explicit grant of exactly this key. Role is not an input
 * on purpose — there is no role that opens these.
 */
export function decideFounderFeatureAccess(input: {
  email: string | null | undefined;
  grantedKeys: readonly string[];
  featureKey: string;
}): boolean {
  if (isFounderEmail(input.email)) return true;
  // Only a real founder-only key can be opened by a grant here; anything
  // else asked through this door stays shut (fail closed).
  if (!isFounderOnlyFeature(input.featureKey)) return false;
  return input.grantedKeys.includes(input.featureKey);
}

/**
 * May `actorEmail` hand out (or take back) this feature?
 * Founder-only features: the founder account only. Everything else is the
 * ordinary admin decision, made by the caller's requireAdmin.
 */
export function canGrantFeature(input: { actorEmail: string | null | undefined; featureKey: string }): boolean {
  if (isFounderOnlyFeature(input.featureKey)) return isFounderEmail(input.actorEmail);
  return true;
}

/** The Business's tabs, in strip order, and who may open each. `feature`
 *  set = founder or a grant of it; unset = the founder alone. */
export const FOUNDER_TABS = [
  { href: "/founder/numbers", label: "Numbers", feature: FOUNDER_FEATURES.numbers },
  { href: "/founder/focus", label: "Schedule" },
  { href: "/founder/pnl", label: "P&L" },
  { href: "/founder/sales", label: "Sales & Marketing", feature: FOUNDER_FEATURES.sales },
] as const satisfies ReadonlyArray<{ href: string; label: string; feature?: FounderFeatureKey }>;

export type FounderTab = (typeof FOUNDER_TABS)[number];

/** The tabs this person may open, in strip order. Empty = no way into
 *  The Business at all (no nav entry). */
export function allowedFounderTabs(input: {
  email: string | null | undefined;
  grantedKeys: readonly string[];
}): FounderTab[] {
  return FOUNDER_TABS.filter(tab => {
    if (isFounderEmail(input.email)) return true;
    if (!("feature" in tab)) return false;
    return decideFounderFeatureAccess({ ...input, featureKey: tab.feature });
  });
}
