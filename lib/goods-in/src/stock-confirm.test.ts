import { describe, expect, it } from "vitest";
import { stockConfirmLines } from "./stock-confirm";

const basil = { lineId: 1, name: "Fresh Basil", unit: "g", quantityOrdered: 300, previousReceived: 0, newReceived: 300 };

describe("stockConfirmLines", () => {
  it("shows what each item adds to stock on a first receive", () => {
    expect(stockConfirmLines([basil])).toEqual([
      { lineId: 1, name: "Fresh Basil", changeText: "+300 g", detail: "300 g received of 300 g ordered", kind: "add", short: false },
    ]);
  });

  it("says plainly when an item isn't received or is short", () => {
    const [none, short] = stockConfirmLines([
      { ...basil, newReceived: 0 },
      { lineId: 2, name: "Table Salt", unit: "kg", quantityOrdered: 24, previousReceived: 0, newReceived: 18 },
    ]);
    expect(none).toMatchObject({ changeText: "Nothing", detail: "Not received — 300 g ordered", kind: "none" });
    expect(short).toMatchObject({ changeText: "+18 kg", short: true });
  });

  it("on an edit, shows only the change since the last save", () => {
    const [l] = stockConfirmLines([{ ...basil, previousReceived: 300, newReceived: 250 }]);
    expect(l).toMatchObject({ changeText: "−50 g", kind: "remove", short: true });
  });
});
