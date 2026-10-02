/**
 * The test-box LAUNCH CHECKLIST — the one-off steps that get a box on sale
 * (Graeme, 2026-10-02). This is the ONE place the steps are written down:
 * the scheduler (test-box-schedule.ts) turns them into dated tasks, the
 * tasks become to-dos on the box owner's list, and the page shows them. The
 * UI never names a step itself.
 *
 * Nothing here talks to Shopify, Zapiet or Klaviyo. Steps marked `automated`
 * are done by the app when someone presses its button — "Create Shopify
 * products" on the box (routes/test-box-shopify.ts) makes the drafts and the
 * collection and ticks shopify-products / shopify-collection by key; they can
 * still be ticked by hand. Everything else is done by a person and ticked;
 * the shopify-* hand steps are what the app's products still need (read from
 * the live store, 2026-10-02 — see lib/test-box-shopify-rules.ts).
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
  /** Done by the app (with a button on the box) rather than by a person. */
  automated: boolean;
}

export const LAUNCH_CHECKLIST: readonly LaunchStepTemplate[] = [
  {
    key: "shopify-products",
    title: () => "Make each recipe's Shopify product as a draft, hidden from the main website",
    how: c => `The app does this: 'Create Shopify products' below duplicates the last test-box product for each recipe as a draft — tags show, no-wholesale, calzones and '${c.boxName}', the app's ingredient deck, description and pack size, no barcode — and links it to the recipe so its sales reach the planner. Ticks itself once every recipe has a product. By hand: Shopify → Products → the last test-box product → Duplicate.`,
    from: "launch", workingDaysBefore: 3, automated: true,
  },
  {
    key: "shopify-collection",
    title: c => `Shopify collection '${c.boxName}' (tag = box name)`,
    how: c => `The app makes it with the first product: a smart collection named '${c.boxName}' that picks up every product tagged '${c.boxName}'. By hand: Shopify → Collections → Create → Smart, condition "Product tag is equal to ${c.boxName}".`,
    from: "launch", workingDaysBefore: 3, automated: true,
  },
  {
    key: "shopify-barcodes",
    title: () => "Add GS1 barcodes to the new Shopify products",
    how: () => "The new products have no barcode. Get a number for each from GS1 and add it to the product's 2 Pack variant in Shopify.",
    from: "launch", workingDaysBefore: 2, automated: false,
  },
  {
    key: "shopify-nutrition",
    title: () => "Upload each new product's nutrition table image",
    how: () => "The website's nutrition table is an image (custom.nutritional_info), so the app can't write it — it removes the copied product's one. The numbers are under 'Create Shopify products' on this box.",
    from: "launch", workingDaysBefore: 2, automated: false,
  },
  {
    key: "shopify-images",
    title: () => "Check or replace the new products' images",
    how: () => "The products start with the copied product's photos (unless that was switched off). Swap in this recipe's photos when you have them.",
    from: "launch", workingDaysBefore: 2, automated: false,
  },
  {
    key: "shopify-price",
    title: () => "Check each new product's price",
    how: () => "The price is copied from the product it was duplicated from — set this recipe's price in Shopify.",
    from: "launch", workingDaysBefore: 2, automated: false,
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
    key: "shopify-go-live",
    title: c => `Put the '${c.boxName}' products live: set them Active and publish the collection`,
    how: c => `The app only makes drafts and never publishes. On launch day: each product → Status Active (check its sales channels), and publish the '${c.boxName}' collection to the Online Store.`,
    from: "launch", workingDaysBefore: 0, automated: false,
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
    how: () => "Launch-day post on social media — this to-do is on the marketing calendar on launch day.",
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
