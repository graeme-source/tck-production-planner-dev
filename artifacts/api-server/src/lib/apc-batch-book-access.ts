/**
 * Who may press what in APC batch booking (Graeme, 9 Nov 2026). Pure, tested.
 *
 * Everyone on Order Packing Live books the day's orders: the ones that go
 * through get labels and the team packs; the ones that fail land in Booking
 * issues today and stay unbooked. Sorting those out (a retry, or booking on a
 * different service code) is for people with "Fix APC booking problems".
 */
export function batchBookNeedsFixPermission(body: { retry?: boolean; serviceCodeOverride?: string | null }): boolean {
  return body.retry === true || !!body.serviceCodeOverride;
}

export const FIX_PERMISSION_MESSAGE = "Retrying a booking that failed needs the \"Fix APC booking problems\" permission — ask a manager.";
