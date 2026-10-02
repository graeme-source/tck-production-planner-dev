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
  /** How many recipes the box has (for the "decide on recipes" hint). */
  recipeCount?: number;
}

/** A step the app can do: the page shows its button on the step. */
export type LaunchAction = "shopify-products" | "shopify-collection" | "discount-code";

export interface LaunchStepTemplate {
  /** Stable — ticks and to-dos are stored against "launch:<key>". */
  key: string;
  title: (c: LaunchStepContext) => string;
  /** A short "how", shown under the step and in the to-do's notes. */
  how: (c: LaunchStepContext) => string;
  /** Which date the due date counts from ("vip-window-end" = launch + the
   *  VIP guarantee, VIP_GUARANTEE_HOURS in test-box-schedule.ts; "first-
   *  production" / "first-delivery" = the box's earliest open delivery —
   *  the step is left out until the box has one). */
  from: "launch" | "public-launch" | "vip-window-end" | "first-production" | "first-delivery";
  /** Working days before that date (0 = on the day itself, weekend or not). */
  workingDaysBefore: number;
  /** Working days AFTER that date instead (e.g. the survey after delivery). */
  workingDaysAfter?: number;
  /** An in-app page that does the job, with its button label. */
  link?: (c: LaunchStepContext) => { href: string; label: string };
  /** Only when the box has a public launch date. */
  onlyWithPublicLaunch?: boolean;
  /** Repeated once per delivery date (key gets "-d<deliveryId>"). */
  perDelivery?: boolean;
  /** Done by the app (with a button on the box) rather than by a person. */
  automated: boolean;
  /** The app's button for this step (automated steps only). */
  action?: LaunchAction;
  /** A nudge shown under the step, or nothing. */
  hint?: (c: LaunchStepContext) => string | undefined;
}

export const LAUNCH_CHECKLIST: readonly LaunchStepTemplate[] = [
  {
    key: "decide-recipes",
    title: () => "Decide on recipes",
    how: () => "Pick the 2–4 recipes for the box (above) and tick this when they're settled. The Shopify collection waits for this tick.",
    hint: c => (c.recipeCount ?? 0) < 2 ? `The box has ${c.recipeCount ?? 0} recipe${c.recipeCount === 1 ? "" : "s"} — a test box works best with 2–4.` : undefined,
    // Same day as the Shopify steps (listed first): any earlier would make
    // every box planned a week out look like a "tight timeline".
    from: "launch", workingDaysBefore: 3, automated: false,
  },
  {
    // Key kept from the hand-made version so earlier ticks stay.
    key: "shopify-products",
    title: () => "Create Shopify products",
    how: c => `The app duplicates the last test-box product for each recipe as a draft — tags show, no-wholesale, calzones and '${c.boxName}', the app's ingredient deck, description and pack size, no barcode — and links it to the recipe so its sales reach the planner. One at a time or all together; or link a product made by hand. Ticks itself once every recipe has a product.`,
    from: "launch", workingDaysBefore: 3, automated: true, action: "shopify-products",
  },
  {
    key: "shopify-collection",
    title: () => "Create the Shopify collection",
    how: c => `A smart collection named '${c.boxName}' that picks up every product tagged '${c.boxName}', set up like the last test box's. Ready once the recipes are decided and every recipe has a Shopify product. Ticks itself.`,
    from: "launch", workingDaysBefore: 3, automated: true, action: "shopify-collection",
  },
  {
    key: "discount-code",
    title: () => "Create the 20% discount code",
    how: c => `One shared code, 20% off the '${c.boxName}' collection only, set up like the last test box's code. Ready once the collection exists. Ticks itself.`,
    from: "launch", workingDaysBefore: 2, automated: true, action: "discount-code",
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
    how: () => "The website's nutrition table is an image (custom.nutritional_info), so the app can't write it — it removes the copied product's one. The numbers are in 'Create Shopify products' on this box.",
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
    key: "back-labels",
    title: () => "Create the back labels",
    how: c => `A back label for each '${c.boxName}' recipe, from its ingredient deck, allergens and nutrition (Product Hub → Labels). Print and check them before the first production day.`,
    link: () => ({ href: "/product-hub", label: "Open Product Hub" }),
    from: "first-production", workingDaysBefore: 1, automated: false,
  },
  {
    key: "survey",
    title: () => "Create and send the customer survey",
    how: c => `In Surveys: create a survey from the '${c.boxName}' collection asking customers to rate each product, then email it to everyone who bought.`,
    link: () => ({ href: "/surveys", label: "Open Surveys" }),
    from: "first-delivery", workingDaysAfter: 2, workingDaysBefore: 0, automated: false,
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
