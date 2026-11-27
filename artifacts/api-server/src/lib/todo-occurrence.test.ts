import { describe, expect, it } from "vitest";
import { shouldCreateNextOccurrence } from "./todo-occurrence";

describe("shouldCreateNextOccurrence", () => {
  it("makes the next one only when that day isn't already listed", () => {
    expect(shouldCreateNextOccurrence("2026-12-09", [])).toBe(true);
    expect(shouldCreateNextOccurrence("2026-12-09", ["2026-12-09", "2026-12-16"])).toBe(false);
    expect(shouldCreateNextOccurrence("2026-12-30", ["2026-12-09T00:00:00.000Z", null])).toBe(true);
  });
});
