/**
 * The monthly bonus scheme agreed for Tommy (Graeme, 27–29 Oct 2026), as
 * numbers the founder can tweak on The Business → Bonus calculator:
 *
 *   - Revenue = orders SENT OUT that month.
 *   - Under the minimum: nothing. At the minimum: `atMinimum` (£50). Then it
 *     climbs slowly and steeply near the top — atMinimum + (atStretch −
 *     atMinimum) × progress^curve, progress = how far from minimum to
 *     stretch (0–1) — to `atStretch` (£500) at that month's stretch.
 *   - Above stretch: + `perStep` (£50) for every full `step` (£5k), up to
 *     `maxBonus` (£750).
 *   - Profit protection: the bonus can never take that month's net operating
 *     profit below `profitFloorPct` (5%) of revenue — it's cut to whatever
 *     profit is left above that, or nothing.
 *
 * Pure — unit-tested.
 */

export interface BonusScheme {
  atMinimum: number;
  atStretch: number;
  /** 2 = the agreed "slow then steep" curve; 1 = a straight line. */
  curve: number;
  step: number;
  perStep: number;
  maxBonus: number;
  profitFloorPct: number;
  /** Employer NI on top of the bonus, for the cost line. */
  employerNiPct: number;
}

export const DEFAULT_BONUS_SCHEME: BonusScheme = {
  atMinimum: 50,
  atStretch: 500,
  curve: 2,
  step: 5000,
  perStep: 50,
  maxBonus: 750,
  profitFloorPct: 5,
  employerNiPct: 15,
};

/** The bonus the revenue earns, before the profit check (whole pounds). */
export function revenueBonus(revenue: number, minimum: number, stretch: number, s: BonusScheme): number {
  if (!(revenue >= minimum) || !(minimum > 0)) return 0;
  if (stretch <= minimum || revenue >= stretch) {
    const top = Math.max(stretch, minimum);
    const steps = s.step > 0 ? Math.floor((revenue - top) / s.step) : 0;
    return Math.round(Math.min(Math.max(s.maxBonus, s.atStretch), s.atStretch + steps * s.perStep));
  }
  const progress = (revenue - minimum) / (stretch - minimum);
  return Math.round(s.atMinimum + (s.atStretch - s.atMinimum) * Math.pow(progress, Math.max(0.1, s.curve)));
}

export interface BonusResult {
  /** 0–1 from minimum to stretch (1 at or above stretch). */
  progress: number;
  revenueBonus: number;
  /** Profit kept no matter what: floor% of revenue. */
  profitFloor: number;
  /** Profit above the floor — the most the bonus can be. */
  room: number;
  paid: number;
  /** Bonus + employer NI. */
  cost: number;
  /** Why the paid figure is what it is, in plain words. */
  reason: "below-minimum" | "full" | "cut-by-profit" | "no-profit-room";
}

export function bonusFor(input: { revenue: number; profit: number; minimum: number; stretch: number }, s: BonusScheme): BonusResult {
  const { revenue, profit, minimum, stretch } = input;
  const earned = revenueBonus(revenue, minimum, stretch, s);
  const progress = revenue < minimum ? 0 : stretch <= minimum ? 1 : Math.min(1, (revenue - minimum) / (stretch - minimum));
  const profitFloor = Math.round(Math.max(0, revenue) * s.profitFloorPct) / 100;
  const room = Math.max(0, Math.floor(profit - profitFloor));
  const paid = Math.min(earned, room);
  return {
    progress,
    revenueBonus: earned,
    profitFloor,
    room,
    paid,
    cost: Math.round(paid * (1 + s.employerNiPct / 100)),
    reason: earned === 0 ? "below-minimum" : paid === earned ? "full" : paid > 0 ? "cut-by-profit" : "no-profit-room",
  };
}

/** Revenue points for the "what it pays" table: the minimum, quarters to
 *  stretch, then each step above stretch until the cap. */
export function bonusLadder(minimum: number, stretch: number, s: BonusScheme): Array<{ revenue: number; bonus: number; profitNeeded: number }> {
  const points: number[] = [];
  if (stretch > minimum) for (const f of [0, 0.25, 0.5, 0.75, 1]) points.push(Math.round(minimum + (stretch - minimum) * f));
  else points.push(minimum);
  const top = Math.max(stretch, minimum);
  for (let r = top + s.step; s.step > 0 && points.length < 14; r += s.step) {
    points.push(r);
    if (revenueBonus(r, minimum, stretch, s) >= Math.max(s.maxBonus, s.atStretch)) break;
  }
  return points.map(revenue => {
    const bonus = revenueBonus(revenue, minimum, stretch, s);
    return { revenue, bonus, profitNeeded: Math.ceil(revenue * s.profitFloorPct / 100 + bonus) };
  });
}
