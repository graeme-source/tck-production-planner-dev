/**
 * What weight we declare to APC when booking a consignment.
 *
 * Shopify's `total_weight` is a VOLUME proxy, not a weight. Every calzone pack
 * is recorded as a flat 1kg because packs are a fixed size, so "over 7kg"
 * really means "more than 7 packs — won't fit a small box". The real parcel
 * weighs considerably less than the figure says, and we don't track what it
 * actually is.
 *
 * That proxy is right for choosing a box and wrong to hand to a courier. The
 * light services (LW16 weekday / WL16 weekend) carry up to 5kg and reject
 * anything above it outright with "NO Services available" — no mention of
 * weight, which is what made it look like a postcode-coverage problem. On
 * 2026-08-21 it blocked 13 of 44 bookings, including an 8-pack to a Liverpool
 * postcode that had booked happily at 5000g two days earlier.
 *
 * The ceiling is therefore tied to the SERVICE, not to the box size: if the
 * service codes are reconfigured the cap follows them, because it keys off the
 * code actually about to be sent.
 */

/**
 * Is this a large box?
 *
 * WEIGHT decides, and the box-size tag can only ever PROMOTE to large — never
 * demote. That asymmetry is the whole point: forcing a genuinely large box
 * onto a light service puts a small-service label on a big parcel, which APC
 * can refuse at the depot. The order is then binned and remade, which is worse
 * than any booking failure. A mis-tagged order must still route by what is
 * actually in it (Graeme, 2026-08-21).
 *
 * The tag used to win outright, so a "Small Box"-tagged 8-pack was sent as a
 * small parcel. Before the 5kg cap that failed loudly at booking, which is how
 * the mis-tag got noticed; with the cap it would have booked silently on the
 * wrong service. Hence weight-first.
 *
 * `thresholdGrams` is a VOLUME rule in disguise — Shopify records every pack
 * as a flat 1kg, so 7001g means "more than 7 packs, won't fit a small box".
 */
export function isLargeBox(tags: string, weightGrams: number | null | undefined, thresholdGrams: number): boolean {
  const list = (tags ?? "").split(",").map(t => t.trim().toLowerCase());
  const hasLargeTag = list.includes("large box") || list.includes("wholesale");
  return hasLargeTag || (weightGrams ?? 0) >= thresholdGrams;
}

/** Ceiling for the light services (LW16 weekday / WL16 weekend). Proven: no
 *  WL16 consignment has ever carried more, and every one that tried was
 *  refused. */
export const LIGHT_SERVICE_MAX_KG = 5;

/** Ceiling for the heavy services (ND16 weekday / WD16 weekend).
 *
 *  UNPROVEN, unlike the 5kg one. WD16 is known to have carried exactly 10kg
 *  successfully, and nothing heavier has been attempted, so this is insurance
 *  against repeating the WL16 surprise rather than a measured limit. It is a
 *  no-op for every order seen to date (the heaviest large box on the
 *  2026-08-22 batch declared 8.4kg). If APC confirms a different figure, this
 *  is the one line to change. */
export const HEAVY_SERVICE_MAX_KG = 10;

/**
 * @param nominalGrams  Shopify `total_weight` — the volume proxy, not a weight.
 * @param serviceCode   The APC service code this consignment will be booked on.
 * @param lightServiceCodes  Codes capped at 5kg, from app settings.
 * @param heavyServiceCodes  Codes capped at 10kg, from app settings.
 */
export function declaredParcelWeightKg(
  nominalGrams: number | null | undefined,
  serviceCode: string,
  lightServiceCodes: readonly string[],
  heavyServiceCodes: readonly string[] = [],
): number {
  // 0.1kg floor: APC rejects a zero-weight parcel, and an order with no
  // weight recorded still has to ship.
  const nominalKg = Math.max(0.1, (nominalGrams ?? 500) / 1000);
  // An unset app setting reads as "", which must never match a service code —
  // otherwise a missing setting would silently cap every parcel.
  const matches = (codes: readonly string[]) => codes.some(c => c !== "" && c === serviceCode);

  if (matches(lightServiceCodes)) return Math.min(nominalKg, LIGHT_SERVICE_MAX_KG);
  if (matches(heavyServiceCodes)) return Math.min(nominalKg, HEAVY_SERVICE_MAX_KG);
  // An unrecognised code is sent as-is rather than guessed at.
  return nominalKg;
}
