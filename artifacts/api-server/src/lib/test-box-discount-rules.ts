/**
 * Test box 20% discount code — the rules (pure, tested). Objectives A and I.
 *
 * READ-ONLY inspection of the live store's earlier test-box codes
 * (2026-10-02; "CC20-…" for the August Test Box, "CC-MEX-…" for Sabores de
 * México, "CC-MAR26…" for the American BBQ box): every one is a basic code,
 * 20% off, applying to the box's collection ONLY, combining with no other
 * discount, any customer, no minimum, no usage limit, not once-per-customer,
 * one-time purchases only (not subscriptions), with an end date a few weeks
 * after launch. Those settings are the default here and are re-read from the
 * most recent test-box code each time, so a change Graeme makes by hand
 * carries forward.
 *
 * Code: "CC" + launch month (3 letters, upper case) + 2-digit year + "-" + 6
 * random letters/digits without the look-alikes 0/O/1/I — e.g. CCOCT26-7K2P9Q.
 * One shared code for everyone; it only looks unique.
 */

/** No 0/O/1/I: a code read out or typed from an email must not be ambiguous. */
export const DISCOUNT_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const TEST_BOX_DISCOUNT_PERCENT = 20;

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function discountCodePrefix(launchDate: string): string {
  const [y, m] = launchDate.split("-").map(Number);
  return `CC${MONTHS[m - 1]}${String(y).slice(-2)}`;
}

/** "CCOCT26-7K2P9Q". `random` returns [0, 1) — injectable for tests. */
export function generateDiscountCode(launchDate: string, random: () => number = Math.random): string {
  let tail = "";
  for (let i = 0; i < 6; i++) tail += DISCOUNT_ALPHABET[Math.floor(random() * DISCOUNT_ALPHABET.length) % DISCOUNT_ALPHABET.length];
  return `${discountCodePrefix(launchDate)}-${tail}`;
}

export function isTestBoxCode(code: string): boolean {
  return /^CC[A-Z]{3}\d{2}-[A-HJ-NP-Z2-9]{6}$/.test(code);
}

export interface DiscountSettings {
  combinesWith: { orderDiscounts: boolean; productDiscounts: boolean; shippingDiscounts: boolean };
  appliesOncePerCustomer: boolean;
  usageLimit: number | null;
  appliesOnOneTimePurchase: boolean;
  appliesOnSubscription: boolean;
  /** Where the settings came from, for the preview. */
  copiedFrom: string | null;
}

export const DEFAULT_TEST_BOX_DISCOUNT: DiscountSettings = {
  combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false },
  appliesOncePerCustomer: false,
  usageLimit: null,
  appliesOnOneTimePurchase: true,
  appliesOnSubscription: false,
  copiedFrom: null,
};

/** A discount as read from Shopify (the fields we copy). */
export interface ExistingDiscount {
  title: string;
  percentage: number | null;
  collectionTitles: string[];
  combinesWith: DiscountSettings["combinesWith"];
  appliesOncePerCustomer: boolean;
  usageLimit: number | null;
  appliesOnOneTimePurchase: boolean;
  appliesOnSubscription: boolean;
}

/**
 * Settings to copy: the newest earlier code that is 20% off a COLLECTION
 * (the test-box shape) — never a whole-store or one-product code. Codes
 * arrive newest first.
 */
export function settingsFromPrevious(codes: ExistingDiscount[]): DiscountSettings {
  const prev = codes.find(c => c.percentage != null && Math.abs(c.percentage - TEST_BOX_DISCOUNT_PERCENT / 100) < 1e-9 && c.collectionTitles.length > 0);
  if (!prev) return DEFAULT_TEST_BOX_DISCOUNT;
  return {
    combinesWith: prev.combinesWith,
    appliesOncePerCustomer: prev.appliesOncePerCustomer,
    usageLimit: prev.usageLimit,
    appliesOnOneTimePurchase: prev.appliesOnOneTimePurchase,
    appliesOnSubscription: prev.appliesOnSubscription,
    copiedFrom: prev.collectionTitles.join(", "),
  };
}

/** The last open delivery's latest close date — the optional end date. */
export function suggestedEndDate(deliveries: Array<{ status: string; latestClose: string }>): string | null {
  const open = deliveries.filter(d => d.status === "open").map(d => d.latestClose).sort();
  return open.length ? open[open.length - 1] : null;
}

/** 23:59:59 on a London calendar day, as an ISO instant. */
export function endOfLondonDay(date: string): string {
  // London is UTC+0 or UTC+1; find which by formatting noon that day.
  const noon = new Date(`${date}T12:00:00Z`);
  const londonHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(noon));
  const offset = londonHour - 12; // 0 or 1
  return new Date(Date.parse(`${date}T23:59:59Z`) - offset * 3_600_000).toISOString();
}

/** discountCodeBasicCreate's input. */
export function discountInput(input: {
  code: string;
  collectionGid: string;
  settings: DiscountSettings;
  startsAt: string;
  endsAt: string | null;
}) {
  return {
    title: input.code,
    code: input.code,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    context: { all: "ALL" },
    combinesWith: input.settings.combinesWith,
    appliesOncePerCustomer: input.settings.appliesOncePerCustomer,
    usageLimit: input.settings.usageLimit,
    customerGets: {
      value: { percentage: TEST_BOX_DISCOUNT_PERCENT / 100 },
      items: { collections: { add: [input.collectionGid] } },
      appliesOnOneTimePurchase: input.settings.appliesOnOneTimePurchase,
      appliesOnSubscription: input.settings.appliesOnSubscription,
    },
  };
}

/** Plain-English lines for the preview. */
export function describeSettings(s: DiscountSettings, collectionTitle: string, endsOn: string | null): string[] {
  const combines = Object.entries(s.combinesWith).filter(([, v]) => v).map(([k]) => k.replace("Discounts", ""));
  return [
    `${TEST_BOX_DISCOUNT_PERCENT}% off products in the '${collectionTitle}' collection only`,
    "Any customer, no minimum spend",
    s.usageLimit != null ? `Can be used ${s.usageLimit} time${s.usageLimit === 1 ? "" : "s"} in total` : "No limit on how many times it's used",
    s.appliesOncePerCustomer ? "Once per customer" : "Customers can use it more than once",
    combines.length ? `Combines with ${combines.join(", ")} discounts` : "Doesn't combine with other discounts",
    s.appliesOnSubscription ? (s.appliesOnOneTimePurchase ? "One-off and subscription orders" : "Subscription orders only") : "One-off orders only (not subscriptions)",
    endsOn ? `Ends at the end of ${endsOn}` : "No end date",
  ];
}

/** Why the collection / discount buttons are waiting (null = ready). */
export function collectionGate(input: { recipesDecided: boolean; recipeCount: number; linkedCount: number }): string | null {
  if (!input.recipesDecided) return "Tick 'Decide on recipes' first.";
  if (input.recipeCount === 0) return "The box has no recipes yet.";
  if (input.linkedCount < input.recipeCount) {
    const left = input.recipeCount - input.linkedCount;
    return `${left} recipe${left === 1 ? " still needs its" : "s still need their"} Shopify product.`;
  }
  return null;
}

export function discountGate(input: { collectionExists: boolean; existingCode: string | null }): string | null {
  if (input.existingCode) return null;
  if (!input.collectionExists) return "Create the Shopify collection first — the code applies to it.";
  return null;
}
