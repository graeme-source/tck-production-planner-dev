import { describe, it, expect } from "vitest";
import { planStartStock } from "@workspace/stock-prediction";
import { macStockWorking, withLiveStock } from "./mac-stock-working";

describe("mac cheese stock correction on the plan screen", () => {
  // Server said: fridge 30, 9 still to wrap, 12 still to go out today,
  // Thursday makes 21 and dispatches 14 → 34 at the start of Friday.
  const server = planStartStock({
    liveStock: 30, stillToWrapToday: 9, stillToDispatchToday: 12,
    rollForward: [{ date: "2026-09-24", plannedProductionPacks: 21, dispatchPacks: 14 }],
  });

  it("a corrected fridge count goes through the same maths, not straight into the plan", () => {
    expect(server.atPlanStart).toBe(34);
    // The operator counts 26 physically in the fridge. Before 2026-09-25 the
    // plan used 26 as-is — ignoring the 9 still coming off the wrapping line,
    // the 12 still going out today and Thursday's movements.
    const corrected = withLiveStock(server, 26);
    expect(corrected.atPlanStart).toBe(30); // 26 + 9 − 12 + 21 − 14
    expect(corrected.stillToWrapToday).toBe(9);
    expect(corrected.rollForward[0].dispatchPacks).toBe(14);
  });

  it("falls back to live − still to go out when the server sends no working", () => {
    expect(macStockWorking({ liveStock: 30, stillToDispatchToday: 12 }).atPlanStart).toBe(18);
    expect(macStockWorking({ liveStock: 30, stillToDispatchToday: 12, stockWorking: server }).atPlanStart).toBe(34);
  });
});
