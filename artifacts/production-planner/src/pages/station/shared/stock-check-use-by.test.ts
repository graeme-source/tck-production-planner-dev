// #165: a use-by date on a stock check warns when it's today or already past.
import { describe, expect, it } from "vitest";
import { useByWarning } from "./stock-count-units";

describe("useByWarning (#165)", () => {
  const today = "2026-10-22";
  it("warns on today", () => {
    expect(useByWarning("2026-10-22", today)).toMatch(/TODAY/);
  });
  it("warns harder when it has passed", () => {
    expect(useByWarning("2026-10-21", today)).toMatch(/PASSED/);
    expect(useByWarning("2025-12-31", today)).toMatch(/PASSED/);
  });
  it("says nothing for a later date or something that isn't a date", () => {
    expect(useByWarning("2026-10-23", today)).toBeNull();
    expect(useByWarning("", today)).toBeNull();
    expect(useByWarning("22/10/2026", today)).toBeNull();
  });
});
