// Which supplier's default category an invoice takes (Graeme, 26 Nov 2026).
// Pure, tested. Objective I.
import { distinctiveNameWord, merchantsLooselyMatch, normaliseMerchant } from "./merchant-normalise";

export interface VendorDefault { vendorId: number; name: string; defaultCategoryId: number }

/** The supplier an invoice's supplier name belongs to, among those with a
 *  default category: the same name, a loose match ("Vonage Ltd" / "VONAGE"),
 *  or the same distinctive word — and only when exactly one fits. */
export function vendorDefaultFor(supplierName: string | null | undefined, vendors: readonly VendorDefault[]): VendorDefault | null {
  const name = supplierName?.trim();
  if (!name) return null;
  const key = normaliseMerchant(name);
  const exact = vendors.filter((v) => normaliseMerchant(v.name) === key);
  if (exact.length === 1) return exact[0];
  const word = distinctiveNameWord(name);
  const close = vendors.filter((v) => merchantsLooselyMatch(name, v.name) || (word !== "" && distinctiveNameWord(v.name) === word));
  const categories = new Set(close.map((v) => v.defaultCategoryId));
  return close.length > 0 && categories.size === 1 ? close[0] : null;
}
