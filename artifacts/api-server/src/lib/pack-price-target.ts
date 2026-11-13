/**
 * Which price a supplier's pack price is (Graeme, 13 Nov 2026: change a
 * price straight from the Orders screen). An ingredient holds one price for
 * its main supplier and one for its second supplier; a line dragged onto any
 * other supplier has no price of its own there. Pure.
 */
export type PackPriceTarget = "primary" | "secondary" | null;

export function packPriceTarget(
  ing: { supplierId: number | null; secondarySupplierId: number | null },
  supplierId: number,
): PackPriceTarget {
  if (ing.supplierId === supplierId) return "primary";
  if (ing.secondarySupplierId === supplierId) return "secondary";
  return null;
}
