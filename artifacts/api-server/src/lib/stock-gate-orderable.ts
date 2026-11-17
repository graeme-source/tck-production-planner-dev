// Can a customer order this Shopify product at all right now?
//
// The stock gate holds products back from next-day delivery to protect
// tomorrow's dispatch. A product nobody can buy has nothing to protect, and
// holding it only fills the "Held from next-day delivery" dialog with
// warnings nobody can act on. Graeme, 17 Nov 2026: The Benji, Open Fire BBQ
// Chicken & Garlic Butter and Chicken & Bacon Pie Calzone were held while on
// a clearance sale with their online quantity at 0 and "continue selling when
// out of stock" off.
//
// Pure: no database, no network. stock-gating.ts fetches the product and
// passes it in.

export type GateVariantStock = {
  /** Shopify's available quantity, summed across locations. */
  inventoryQuantity: number | null;
  /** "DENY" stops selling at 0; "CONTINUE" keeps selling when out of stock. */
  inventoryPolicy: string | null;
  /** False when Shopify isn't tracking stock for this variant, in which case
   *  the quantity means nothing and it always sells. */
  tracked: boolean | null;
};

export type GateProductStock = {
  /** ACTIVE | DRAFT | ARCHIVED */
  status: string;
  variants: GateVariantStock[];
};

export type Orderability =
  | { orderable: true }
  | { orderable: false; reason: "inactive" | "sold-out"; label: string };

function variantCanSell(v: GateVariantStock): boolean {
  // Unknown fields count as sellable: we only skip a product when Shopify
  // has told us plainly that it can't be bought.
  if (v.tracked === false || v.tracked == null) return true;
  if ((v.inventoryPolicy ?? "").toUpperCase() !== "DENY") return true;
  if (v.inventoryQuantity == null) return true;
  return v.inventoryQuantity > 0;
}

export function productOrderability(p: GateProductStock): Orderability {
  if ((p.status ?? "").toUpperCase() !== "ACTIVE") {
    return { orderable: false, reason: "inactive", label: `product is ${p.status.toLowerCase()} on Shopify` };
  }
  // No variants returned means we can't tell, so it stays in the gate.
  if (p.variants.length > 0 && !p.variants.some(variantCanSell)) {
    return { orderable: false, reason: "sold-out", label: "sold out on Shopify and set not to sell when out of stock" };
  }
  return { orderable: true };
}
