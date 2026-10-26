/**
 * How sales are running right now against normal (Graeme, 26 Oct 2026):
 * "look at sales over the last 7 days ... to get an idea of what's currently
 * going on: are we in a moment where we're selling more than normal or less?"
 *
 *   ratio = calzone packs ordered in the last 7 days
 *         ÷ the average 7 days over the 4 weeks before that
 *
 * By when the orders were PLACED, not delivered, so it reacts within days.
 * Cancelled orders don't count.
 *
 * The late-order forecast already follows the last 4 weeks (its "typical
 * day"), so the end-of-week best guess only nudges it by HALF the gap, and
 * never by more than ±25% — one big email week shouldn't swing the fridge by
 * hundreds of packs. Not yet backtested like the late-order curve was
 * (docs/FACTORY_FORECAST.md); the damping keeps it conservative until it is.
 */
import type { ForecastOrder } from "./late-orders";

const DAY = 86_400_000;
export const MOMENTUM_DAMPING = 0.5;
export const MOMENTUM_CAP = 0.25;

export interface SalesMomentum {
  /** Packs ordered in the last 7 days. */
  last7: number;
  /** Average packs per 7 days over the 4 weeks before that. */
  normal7: number;
  /** last7 ÷ normal7; null without enough history. */
  ratio: number | null;
  /** What the best guess multiplies the usual late orders by. */
  factor: number;
}

export function salesMomentum(orders: readonly Pick<ForecastOrder, "createdAt" | "cancelledAt" | "packs">[], now: number): SalesMomentum {
  let last7 = 0, prior28 = 0;
  for (const o of orders) {
    if (o.cancelledAt != null && o.cancelledAt <= now) continue;
    const age = now - o.createdAt;
    if (age < 0) continue;
    if (age < 7 * DAY) last7 += o.packs;
    else if (age < 35 * DAY) prior28 += o.packs;
  }
  const normal7 = prior28 / 4;
  if (normal7 <= 0) return { last7, normal7, ratio: null, factor: 1 };
  const ratio = last7 / normal7;
  const nudge = Math.max(-MOMENTUM_CAP, Math.min(MOMENTUM_CAP, (ratio - 1) * MOMENTUM_DAMPING));
  return { last7, normal7: Math.round(normal7), ratio, factor: 1 + nudge };
}
