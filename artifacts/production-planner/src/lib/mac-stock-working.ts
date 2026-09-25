import { planStartStock, type PlanStartStock } from "@workspace/stock-prediction";

/** Response fields a mac cheese Stock figure's working is built from.
 *  `stockWorking` is absent only when talking to an older server — fall back
 *  to the terms it did send. */
export interface MacStockWorkingSource {
  liveStock: number;
  stillToDispatchToday: number;
  stockWorking?: PlanStartStock;
}

export function macStockWorking(r: MacStockWorkingSource): PlanStartStock {
  return r.stockWorking ?? planStartStock({ liveStock: r.liveStock, stillToWrapToday: 0, stillToDispatchToday: r.stillToDispatchToday });
}

/** Re-run the same maths with a corrected fridge count (the operator's
 *  physical count), keeping every other term — still to wrap, still to go
 *  out today and the days rolled forward. The raw count is never the
 *  planning stock on its own. */
export function withLiveStock(working: PlanStartStock, liveStock: number): PlanStartStock {
  return planStartStock({ ...working, liveStock });
}
