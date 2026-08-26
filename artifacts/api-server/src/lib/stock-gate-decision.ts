/**
 * What hold, if any, a product should be under right now.
 *
 * The gate defends a despatch horizon: "will the packs we have cover what is
 * due to go out?" Horizon 0 is today's despatch (delivered tomorrow). Horizon
 * 1 is the next despatch day (delivered the day after). Each has its own
 * Shopify tag, whose Zapiet preparation-time rule removes that many days from
 * the delivery picker.
 *
 * The further horizons exist because horizon 0 only defends the despatch
 * already in progress. Sell heavily on a Wednesday evening for Friday
 * delivery and nothing stopped it: Thursday's despatch was not examined until
 * Thursday, by which point the orders were taken (Graeme, 2026-08-26).
 *
 * ── Why a list, not two cases ───────────────────────────────────────────────
 * Two horizons is where this starts, but three or four is the same idea with
 * a longer preparation time, so the rule is written over a list. Adding a
 * horizon is a settings change and one more entry, not a rewrite.
 *
 * ── One hold at a time ──────────────────────────────────────────────────────
 * A product carries at most ONE hold, and therefore one tag. Zapiet's
 * preparation time is a minimum lead time, so it is cumulative: a 3-day rule
 * already removes everything a 2-day rule removes. Two tags on one product
 * would mean depending on how Zapiet resolves competing rules, for no gain.
 *
 * So the furthest breaching horizon wins, and the gate moves a product between
 * holds by releasing the old one and creating the new one. That single
 * mechanism covers escalation (a today-hold becoming a tomorrow-hold as the
 * forecast worsens), de-escalation, and — because the comparison includes the
 * tag and the dry-run flag — it also repairs a hold whose settings have since
 * changed. That last case was a real defect: a hold created during dry run was
 * never upgraded when dry run was switched off, because a product was only
 * ever tagged at the moment its hold was first created. It sat "held" forever
 * with no tag ever reaching Shopify.
 *
 * Pure logic, no database and no Shopify: the decision is the part worth
 * testing, and it should be readable on its own.
 */

export interface HorizonState {
  /** Stable identifier stored on the hold, e.g. "today", "tomorrow". */
  key: string;
  /** Despatch days ahead. 0 = today's despatch. Higher means a longer
   *  preparation time, so a higher number subsumes every lower one. */
  daysAhead: number;
  /** Packs spare once this horizon's despatch is covered. Negative means
   *  oversold. Null when the horizon could not be computed — a missing plan,
   *  a Shopify read that failed — in which case it neither triggers nor
   *  releases, because acting on a guess is worse than doing nothing. */
  surplus: number | null;
  /** Hold at or below this many packs spare. */
  threshold: number;
  /** Release once this many packs spare are back. Deliberately higher than
   *  `threshold`, so a product sitting on the line doesn't flap on and off
   *  the delivery picker every cycle. */
  release: number;
  /** The Shopify tag whose Zapiet rule covers this horizon. */
  tag: string;
  enabled: boolean;
}

export interface DesiredHold {
  horizon: string;
  tag: string;
}

export interface ExistingHold {
  horizon: string;
  tag: string;
  dryRun: boolean;
}

/** Is this horizon breaching? An unknown surplus never triggers. */
function breaching(h: HorizonState): boolean {
  return h.enabled && h.surplus !== null && h.surplus <= h.threshold;
}

/** Has it recovered enough to let a hold go? An unknown surplus never
 *  releases either — a guard is not lifted on missing data. */
function recovered(h: HorizonState): boolean {
  return h.surplus !== null && h.surplus >= h.release;
}

/**
 * The hold this product should be under, or null for none.
 *
 * Horizons are considered furthest-out first, because the furthest tag
 * subsumes the nearer ones. A horizon that is already held stays held until it
 * clears the RELEASE bar rather than the threshold — the hysteresis that stops
 * a product flapping — which is why the held case is tested before the
 * breach case.
 */
export function desiredHold(horizons: HorizonState[], existing: ExistingHold | null): DesiredHold | null {
  const bySeverity = [...horizons].sort((a, b) => b.daysAhead - a.daysAhead);

  for (const h of bySeverity) {
    if (!h.enabled) continue;
    const isHeld = existing?.horizon === h.key;
    if (isHeld && !recovered(h)) return { horizon: h.key, tag: h.tag };
    if (breaching(h)) return { horizon: h.key, tag: h.tag };
  }
  return null;
}

/**
 * Does the live hold already match what we want?
 *
 * Compares the tag and the dry-run flag as well as the horizon, so a hold
 * created under different settings is replaced rather than left stale. This is
 * what makes turning dry run off actually reach Shopify.
 */
export function holdMatches(
  existing: ExistingHold | null,
  desired: DesiredHold | null,
  dryRunNow: boolean,
): boolean {
  if (existing === null && desired === null) return true;
  if (existing === null || desired === null) return false;
  return existing.horizon === desired.horizon
    && existing.tag === desired.tag
    && existing.dryRun === dryRunNow;
}
