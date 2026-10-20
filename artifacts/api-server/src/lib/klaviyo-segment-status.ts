/** Pure parsing of Klaviyo segment reads (kept free of db imports so it can be unit-tested). */

export interface SegmentStatus {
  exists: boolean;
  name: string | null;
  /** Null while Klaviyo is still materialising a fresh segment. */
  profileCount: number | null;
}

/**
 * Klaviyo reports profile_count as 0 (not null) while a new segment is still
 * being built, so "still counting" must come from is_processing. Graeme,
 * 2026-10-20: the Properoni audience said "0 people" right after a rebuild;
 * twelve seconds later Klaviyo had 38.
 */
export function segmentStatusFromAttributes(
  attributes: { name?: string | null; profile_count?: number | null; is_processing?: boolean | null } | undefined,
): SegmentStatus {
  return {
    exists: true,
    name: attributes?.name ?? null,
    profileCount: attributes?.is_processing ? null : (attributes?.profile_count ?? null),
  };
}
