import { describe, expect, it } from "vitest";
import { perTrayGrams } from "./tray-split";

describe("perTrayGrams", () => {
  it("splits a held-back item across the meat's trays", () => {
    expect(perTrayGrams(2464, 4, true)).toBe(616); // 2.464 kg of wine over 4 trays
  });
  it("is nothing when the meat isn't split or has no trays", () => {
    expect(perTrayGrams(2464, 4, false)).toBeNull();
    expect(perTrayGrams(2464, 0, true)).toBeNull();
    expect(perTrayGrams(2464, null, true)).toBeNull();
  });
});
