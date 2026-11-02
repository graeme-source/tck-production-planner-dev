import { describe, expect, it } from "vitest";
import { packsFor } from "./queued-production-rules";

describe("packs for a queued test item on the Orders page", () => {
  it("whole packs: 4.51 L of Malbec in 2.25 L bags → 3 bags", () => expect(packsFor(4.51, 2.25, null)).toBe(3));
  it("then whole cases: 7 packs, case of 6 → 12", () => expect(packsFor(7, 1, 6)).toBe(12));
  it("no float dust: 15 kg in 1 kg packs is 15, not 16", () => expect(packsFor(15.000000001, 1, null)).toBe(15));
  it("nothing needed → nothing", () => expect(packsFor(0, 2.5, null)).toBe(0));
  it("no pack weight → counts in single units", () => expect(packsFor(3.2, 0, null)).toBe(4));
});
