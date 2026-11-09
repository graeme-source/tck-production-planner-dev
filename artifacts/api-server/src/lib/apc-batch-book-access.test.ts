import { describe, expect, it } from "vitest";
import { batchBookNeedsFixPermission } from "./apc-batch-book-access";

describe("batchBookNeedsFixPermission", () => {
  it("lets anyone run a first booking", () => {
    expect(batchBookNeedsFixPermission({})).toBe(false);
    expect(batchBookNeedsFixPermission({ retry: false })).toBe(false);
  });

  it("keeps retries and service-code overrides for people who fix problems", () => {
    expect(batchBookNeedsFixPermission({ retry: true })).toBe(true);
    expect(batchBookNeedsFixPermission({ serviceCodeOverride: "ND16" })).toBe(true);
  });
});
