import { describe, it, expect } from "vitest";
import { waveOf, currentWave, waveFilters } from "./packing-waves";

describe("packing waves — local, large, wholesale, small", () => {
  it("opens on the first wave with orders ready", () => {
    expect(currentWave({ local: 2, large: 1, small: 4 }, null)).toBe("local");
    expect(currentWave({ local: 0, large: 1, small: 4 }, null)).toBe("large");
    expect(currentWave({ local: 0, large: 0, wholesale: 0, small: 4 }, null)).toBe("small");
  });
  it("moves on by itself when a wave is done, and stays on one that's chosen", () => {
    expect(currentWave({ local: 0, large: 3, small: 4 }, "local")).toBe("large");
    expect(currentWave({ local: 1, large: 3, small: 4 }, "small")).toBe("small");
  });
  it("nothing left → no wave", () => {
    expect(currentWave({}, null)).toBeNull();
  });
  it("sorts orders into waves; collections aren't packed in one", () => {
    expect(waveOf("local delivery")).toBe("local");
    expect(waveOf("large box")).toBe("large");
    expect(waveOf("other")).toBe("small");
    expect(waveOf("collection")).toBeNull();
  });
  it("courier waves show booked orders only when the app books labels", () => {
    expect(waveFilters("large", true)).toEqual({ box: ["large box"], label: "booked" });
    expect(waveFilters("small", false)).toEqual({ box: ["small box", "other"], label: "all" });
    expect(waveFilters("local", true)).toEqual({ box: [], label: "local" });
  });
});
