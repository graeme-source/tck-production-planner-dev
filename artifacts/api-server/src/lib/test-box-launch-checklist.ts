/**
 * The test-box LAUNCH CHECKLIST — the one-off steps that get a box on sale
 * (Graeme, 2026-10-02). This is the ONE place the steps are written down:
 * the scheduler (test-box-schedule.ts) turns them into dated tasks, the
 * tasks become to-dos on the box owner's list, and the page shows them. The
 * UI never names a step itself.
 *
 * Nothing here talks to Shopify, Zapiet or Klaviyo — every step is done by a
 * person and ticked. When one gets automated later, flip `automated` (the
 * scheduler passes it through so the page and to-do list can say "done by
 * the app") and wire the automation to tick the task by its key.
 *
 * Due dates are in WORKING days (Mon–Fri) before the date named in `from`:
 * Shopify set-up a few days ahead so there's time to check it, the emails
 * and social post on the day itself.
 */

export interface LaunchStepContext {
  boxName: string;
  /** "Fri 16 Oct" — only for the per-delivery Zapiet step. */
  deliveryLabel?: string;
}

export interface LaunchStepTemplate {
  /** Stable — ticks and to-dos are stored against "launch:<key>". */
  key: string;
  title: (c: LaunchStepContext) => string;
  /** A short "how", shown under the step and in the to-do's notes. */
  how: (c: LaunchStepContext) => string;
  /** Which date the due date counts back from ("vip-window-end" = launch +
   *  the VIP guarantee, VIP_GUARANTEE_HOURS in test-box-schedule.ts). */
  from: "launch" | "public-launch" | "vip-window-end";
  /** Working days before that date (0 = on the day itself, weekend or not). */
  workingDaysBefore: number;
  /** Only when the box has a public launch date. */
  onlyWithPublicLaunch?: boolean;
  /** Repeated once per delivery date (key gets "-d<deliveryId>"). */
  perDelivery?: boolean;
  /** Done by the app rather than a person (none yet). */
  automated: boolean;
}

export const LAUNCH_CHECKLIST: readonly LaunchStepTemplate[] = [
  {
    key: "shopify-products",
    title: () => "Duplicate the previous test-box product in Shopify for each recipe — same settings, hidden from the main website",
    how: () => "Shopify → Products → open the last test-box product → Duplicate. Rename it for the recipe, keep the same settings, and keep it out of the main website's collections.",
    from: "launch", workingDaysBefore: 3, automated: false,
  },
  {
    key: "shopify-collection",
    title: c => `Create a Shopify collection named '${c.boxName}' and add the products`,
    how: c => `Shopify → Products → Collections → Create collection. Name it '${c.boxName}' and add each recipe's product.`,
    from: "launch", workingDaysBefore: 3, automated: false,
  },
  {
    key: "discount-code",
    title: () => "Create a 20% discount code for the box",
    how: c => `Shopify → Discounts → Create discount → Amount off products: 20%, applied to the '${c.boxName}' collection.`,
    from: "launch", workingDaysBefore: 2, automated: false,
  },
  {
    key: "zapiet-collection",
    title: c => `Enable delivery dates in Zapiet for the '${c.boxName}' collection`,
    how: c => `Zapiet → Delivery → set up date rules for the '${c.boxName}' collection so customers can only pick this box's delivery dates.`,
    from: "launch", workingDaysBefore: 2, automated: false,
  },
  {
    key: "zapiet-date",
    title: c => `Enable ${c.deliveryLabel ?? "the delivery date"} in Zapiet for '${c.boxName}'`,
    how: c => `Zapiet → Delivery → open the '${c.boxName}' rule and allow ${c.deliveryLabel ?? "this date"}.`,
    from: "launch", workingDaysBefore: 2, perDelivery: true, automated: false,
  },
  {
    key: "vip-email",
    title: () => "Write and schedule the VIP launch email",
    how: () => "It's on the marketing calendar as a planned email on launch day — write it in Klaviyo, link it there and get it approved.",
    from: "launch", workingDaysBefore: 0, automated: false,
  },
  {
    key: "social-post",
    title: () => "Post on social media",
    how: () => "Launch-day post — it's on the marketing calendar as a note.",
    from: "launch", workingDaysBefore: 0, automated: false,
  },
  {
    key: "vip-window-over",
    title: () => "VIP window over — decide: keep selling, open to the public, or close",
    how: () => "VIP Calzoney Club members have had their guaranteed 48 hours. Keep selling to VIPs, add a public launch date, or close orders.",
    from: "vip-window-end", workingDaysBefore: 0, automated: false,
  },
  {
    key: "public-email",
    title: () => "Write and schedule the public launch email",
    how: () => "Only because a public launch date is set — the email to everyone, not just VIPs.",
    from: "public-launch", workingDaysBefore: 0, onlyWithPublicLaunch: true, automated: false,
  },
];

/** "launch:discount-code", "launch:zapiet-date-d12". */
export function launchTaskKey(stepKey: string, deliveryId?: number): string {
  return deliveryId != null ? `launch:${stepKey}-d${deliveryId}` : `launch:${stepKey}`;
}
