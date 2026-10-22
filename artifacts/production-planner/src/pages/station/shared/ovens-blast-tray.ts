/**
 * Ovens-station wording for the mac cheese blast-chiller tray button and the
 * chill-timer hint (Fix queue #321).
 *
 * The old button said "Waiting for building" whenever there was nothing left
 * to add — including when every pack from building was already in — and the
 * chill hint talked about "the final batch", while for mac cheese the timer
 * actually starts from the sauce temperature after melting cheese. Both sent
 * people looking at the wrong thing.
 */

export const BLAST_TRAY_SIZE = 10;

export interface BlastTrayState {
  /** Packs the next tap would add (0 = nothing to add). */
  addCount: number;
  /** Packs already through the ovens/blast chiller. */
  ovensCount: number;
  /** Packs built so far (both building lines). */
  builtCount: number;
  /** Planned packs for this item. */
  target: number;
  /** A builder marked this item finished for the day. */
  buildingFinished: boolean;
}

/** Nothing more is coming from building: the plan's packs are all in, or
 *  building is finished and every built pack has been taken in. */
export function allPacksIn(s: BlastTrayState): boolean {
  if (s.addCount > 0) return false;
  if (s.target > 0 && s.ovensCount >= s.target) return true;
  return s.buildingFinished && s.ovensCount >= s.builtCount;
}

export function blastTrayLabel(s: BlastTrayState): string {
  if (s.addCount >= BLAST_TRAY_SIZE) return `Blast Chiller Tray (+${BLAST_TRAY_SIZE} packs)`;
  if (s.addCount > 0) return `Add Final ${s.addCount} Pack${s.addCount === 1 ? "" : "s"}`;
  return allPacksIn(s) ? "All packs in" : "Waiting for building";
}

/** The chill timer's "not started yet" hint. Mac cheese has no oven weight
 *  log — its chill starts from Check 2 on the Macaroni Cheese station. */
export function chillNotStartedHint(isMacCheese: boolean): string {
  return isMacCheese
    ? "Starts when the sauce temperature after melting cheese is logged on the Macaroni Cheese station"
    : "Starts when the final batch for this recipe is logged";
}
