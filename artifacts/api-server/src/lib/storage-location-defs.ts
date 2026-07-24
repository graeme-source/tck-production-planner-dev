/**
 * Canonical definitions for the built-in ("system") storage locations and
 * the mapping between a storage_locations row and the string key that
 * stock_entries.location uses.
 *
 * These six were originally hardcoded in stock-control.ts. They're shared
 * now because the delete endpoint needs the same name→key mapping to find
 * (and clear) a location's stock before it's removed. The stock-control
 * dashboard still owns display; this module is just the source of truth
 * for the keys + per-location item-type restrictions.
 */
export const LOCATION_DEFS = [
  { key: "production_fridge",  label: "Production Fridge",  zone: "fridge",   icon: "fridge",   itemTypes: ["recipe"] },
  { key: "production_freezer", label: "Production Freezer", zone: "freezer",  icon: "freezer",  itemTypes: ["recipe"] },
  { key: "prep_fridge",        label: "Prep Fridge",        zone: "fridge",   icon: "fridge",   itemTypes: ["ingredient"] },
  { key: "raw_meat_fridge",    label: "Raw Meat Fridge",    zone: "fridge",   icon: "fridge",   itemTypes: ["ingredient"] },
  { key: "raw_freezer",        label: "Raw Freezer",        zone: "freezer",  icon: "freezer",  itemTypes: ["ingredient"] },
  { key: "dry_store",          label: "Dry Store",          zone: "ambient",  icon: "ambient",  itemTypes: ["ingredient"] },
] as const;

/** The stock_entries.location key a given storage-location row owns.
 *  Built-in fridges carry their stable def key on the row (def_key
 *  column — set by seed/startup backfill), so renaming one never changes
 *  its stock key; everything else is keyed by id. */
export function stockKeyForLocation(loc: { id: number; defKey?: string | null }): string {
  if (loc.defKey && LOCATION_DEFS.some(d => d.key === loc.defKey)) return loc.defKey;
  return `sl_${loc.id}`;
}
