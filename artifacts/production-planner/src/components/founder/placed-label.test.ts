import { describe, expect, it } from "vitest";
import { placedLabel } from "./profit-tracker-api";

// Graeme, 27 Nov 2026: the Placed column shows the time too, London time.
describe("placedLabel", () => {
  it("shows the day and London time (GMT in winter)", () => {
    expect(placedLabel("2026-11-26T14:32:10Z", "2026-11-26")).toBe("26 Nov 14:32");
  });
  it("uses British Summer Time in summer", () => {
    expect(placedLabel("2026-07-01T09:05:00Z", "2026-07-01")).toBe("1 Jul 10:05");
  });
  it("falls back to the day when the time can't be read", () => {
    expect(placedLabel("", "2026-11-26")).toBe("26 Nov");
  });
});
