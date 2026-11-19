// Fridge packs that will be out of date before a plan can sell them.
//
// A pack has to reach the customer with a minimum shelf life left, so every
// batch has a LAST day it can be dispatched (use-by − min days at customer −
// 1 for the overnight delivery; worked out by the caller from the same rule
// the packing closing check uses). Packs still in the fridge after that day
// can never be sold chilled — they get frozen at close-down — so a plan that
// counts them as stock comes out short by exactly that many (fix queue #403:
// six mac cheese packs frozen at close were still counted by the 2pm plan).
//
// Pure arithmetic over date strings (YYYY-MM-DD); no database.

/** One batch of a recipe recorded in the production fridge. */
export interface FridgeShelfBatch {
  batchNumber: number;
  /** Packs recorded against the batch. */
  packs: number;
  useByDate: string;
  /** Last dispatch day that still gives the customer the minimum shelf life. */
  lastDispatchDate: string;
}

/** What planStartStock() needs to take out-of-date packs off the stock. */
export interface ShelfLifeInput {
  /** Today (London), YYYY-MM-DD. */
  today: string;
  /** The first dispatch the plan's opening stock has to serve. */
  planDate: string;
  batches: FridgeShelfBatch[];
}

export interface OutOfDateBatch extends FridgeShelfBatch {
  /** Packs of this batch expected to be left unsold (≤ recorded packs). */
  packs: number;
}

export interface OutOfDateStock {
  /** Fridge packs that cannot be sold by the plan date's dispatch. */
  packs: number;
  /** Of those, the ones whose last dispatch is today or already gone —
   *  freeze these at close-down today. */
  freezeTodayPacks: number;
  batches: OutOfDateBatch[];
}

export interface OutOfDateInput extends ShelfLifeInput {
  /** The physical fridge count (packs). */
  liveStock: number;
  /** Dispatches still to leave the fridge before the plan date, oldest
   *  first: today's outstanding orders, then each working day in between. */
  dispatches: Array<{ date: string; packs: number }>;
}

/**
 * How many of the packs in the fridge now will go out of date before the
 * plan date's dispatch.
 *
 * The fridge count is attributed to the NEWEST recorded batches first — real
 * dispatch is oldest-first, so what is physically left is the newest stock,
 * and old batch rows that were never drawn down must not cry wolf (the same
 * choice the calzone plan and the closing check make). Each dispatch before
 * the plan date then takes the oldest packs that are still in date for it.
 * Whatever is left with a last dispatch day before the plan date is out of
 * date. An estimate: it is only as good as the batch records.
 */
export function outOfDateStock(input: OutOfDateInput): OutOfDateStock {
  const rows = input.batches
    .filter(b => b.packs > 0)
    .slice()
    .sort((a, b) => a.useByDate.localeCompare(b.useByDate) || a.batchNumber - b.batchNumber);
  let remaining = Math.max(0, Math.round(input.liveStock));
  const layers: OutOfDateBatch[] = [];
  for (let i = rows.length - 1; i >= 0 && remaining > 0; i--) {
    const take = Math.min(rows[i].packs, remaining);
    layers.push({ ...rows[i], packs: take });
    remaining -= take;
  }
  layers.reverse(); // oldest first

  for (const dispatch of input.dispatches) {
    let toConsume = Math.max(0, Math.round(dispatch.packs));
    for (const layer of layers) {
      if (toConsume <= 0) break;
      if (layer.lastDispatchDate < dispatch.date) continue; // already too old to send
      const take = Math.min(toConsume, layer.packs);
      layer.packs -= take;
      toConsume -= take;
    }
  }

  const batches = layers.filter(l => l.packs > 0 && l.lastDispatchDate < input.planDate);
  return {
    packs: batches.reduce((s, b) => s + b.packs, 0),
    freezeTodayPacks: batches
      .filter(b => b.lastDispatchDate <= input.today)
      .reduce((s, b) => s + b.packs, 0),
    batches,
  };
}
