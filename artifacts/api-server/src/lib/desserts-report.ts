// The dessert report — ONE implementation, used by both the packing station
// (/api/fulfilment/desserts-report) and the opening checklist's
// desserts_report dynamic data. It was built twice and the two copies
// drifted (Graeme, 2026-08-28).
//
// What the bench needs, in this order:
//   1. how many 5-pack labels to print — they all share one label, so the
//      headline is a single number,
//   2. how many of each 5-pack variant to pull from the freezer and label,
//   3. every other dessert (e.g. cinnamon buns) as its own line.
//
// Order counts are deliberately NOT reported: "2 orders · 3" was read as
// "2 units" often enough to be a defect.

/** A 5-pack is identified on the VARIANT title ("5 Pack"), not the product
 *  title — the products themselves are named "Rolo Chocolate Brownie" etc.
 *  Product title is also checked for the odd product-level 5-pack listing. */
const FIVE_PACK_RE = /5[\s-]*pack/i;

export function isFivePack(productTitle: string, variantTitle?: string | null): boolean {
  return FIVE_PACK_RE.test(variantTitle ?? "") || FIVE_PACK_RE.test(productTitle);
}

export interface DessertLineItem {
  title: string;
  variant_title?: string | null;
  /** Shopify variant id — the 5-pack labels carry that variant's barcode. */
  variant_id?: number | string | null;
  quantity: number;
}

/** One 5-pack variant to label: its own name and barcode on each label
 *  (Graeme, 2026-10-27). */
export interface FivePackLabelLine {
  variantId: string | null;
  /** The product name ("Rolo Chocolate Brownie"). */
  productTitle: string;
  quantity: number;
}

export interface DessertOrder {
  line_items: DessertLineItem[];
}

export interface DessertReportEntry {
  /** What the operator reads: product name, plus the variant when it adds
   *  information (e.g. "Rolo Chocolate Brownie — 5 Pack"). */
  title: string;
  quantity: number;
}

export interface DessertReport {
  /** Non-5-pack desserts (cinnamon buns and friends), one line each. */
  products: DessertReportEntry[];
  /** The 5-pack variants, broken down — what to pull from the freezer. */
  fivePackProducts: DessertReportEntry[];
  /** One number: how many 5-pack labels to print. */
  fivePackTotal: number;
  /** The same 5-packs by Shopify variant, for printing their labels. */
  fivePackLabels: FivePackLabelLine[];
  totalQuantity: number;
}

export function buildDessertReport(orders: DessertOrder[], dessertTitles: Set<string>): DessertReport {
  const fiveTotals = new Map<string, number>();
  const otherTotals = new Map<string, number>();
  const byVariant = new Map<string, FivePackLabelLine>();

  for (const order of orders) {
    for (const item of order.line_items ?? []) {
      if (!dessertTitles.has(item.title)) continue;
      const qty = Number(item.quantity) || 0;
      if (isFivePack(item.title, item.variant_title)) {
        // Keep the variant in the label so two 5-packs of the same product
        // (different flavours/sizes) stay distinguishable on the pull list.
        const label = item.variant_title && !FIVE_PACK_RE.test(item.title)
          ? `${item.title} — ${item.variant_title}`
          : item.title;
        fiveTotals.set(label, (fiveTotals.get(label) ?? 0) + qty);
        const variantId = item.variant_id != null && String(item.variant_id) !== "" ? String(item.variant_id) : null;
        const key = variantId ?? `title:${item.title}`;
        const line = byVariant.get(key) ?? { variantId, productTitle: item.title, quantity: 0 };
        line.quantity += qty;
        byVariant.set(key, line);
      } else {
        otherTotals.set(item.title, (otherTotals.get(item.title) ?? 0) + qty);
      }
    }
  }

  const toSortedEntries = (m: Map<string, number>): DessertReportEntry[] =>
    [...m.entries()]
      .map(([title, quantity]) => ({ title, quantity }))
      .sort((a, b) => a.title.localeCompare(b.title));

  const fivePackProducts = toSortedEntries(fiveTotals);
  const products = toSortedEntries(otherTotals);
  const fivePackTotal = fivePackProducts.reduce((s, p) => s + p.quantity, 0);
  const totalQuantity = fivePackTotal + products.reduce((s, p) => s + p.quantity, 0);

  const fivePackLabels = [...byVariant.values()].filter(l => l.quantity > 0).sort((a, b) => a.productTitle.localeCompare(b.productTitle));
  return { products, fivePackProducts, fivePackTotal, fivePackLabels, totalQuantity };
}
