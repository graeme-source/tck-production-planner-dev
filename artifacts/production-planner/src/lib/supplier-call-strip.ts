/**
 * What the Front Door delivery card's call strip shows for a supplier (#332,
 * Jane Miles): the number to ring and our account number — Brakes ask for the
 * account number before they'll talk to you. Null when there's nothing on
 * file, so the strip never shows empty.
 */
export interface SupplierCallInfo {
  phone?: string | null;
  orderingPhone?: string | null;
  accountNumber?: string | null;
}

export interface CallStrip {
  phone: string | null;
  accountNumber: string | null;
}

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t ? t : null;
};

export function supplierCallStrip(s: SupplierCallInfo | null | undefined): CallStrip | null {
  if (!s) return null;
  // The main number is customer service; the ordering line is the fallback.
  const phone = clean(s.phone) ?? clean(s.orderingPhone);
  const accountNumber = clean(s.accountNumber);
  if (!phone && !accountNumber) return null;
  return { phone, accountNumber };
}
