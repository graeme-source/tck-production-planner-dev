import { describe, it, expect } from "vitest";
import { isPrintBridgePath, isPrintJobStale } from "./print-bridge-paths";

describe("isPrintBridgePath", () => {
  it("lets the bridge's poll and ack through above the login guard", () => {
    expect(isPrintBridgePath("/pending")).toBe(true);
    expect(isPrintBridgePath("/123/complete")).toBe(true);
  });

  it("keeps operator routes behind the login guard", () => {
    expect(isPrintBridgePath("/")).toBe(false);
    expect(isPrintBridgePath("/status")).toBe(false);
    expect(isPrintBridgePath("/abc/complete")).toBe(false);
    expect(isPrintBridgePath("/pending/extra")).toBe(false);
  });
});

describe("isPrintJobStale", () => {
  const now = new Date("2026-10-22T10:00:00Z");
  it("a fresh tap prints", () => {
    expect(isPrintJobStale(new Date("2026-10-22T09:50:00Z"), now)).toBe(false);
  });
  it("a request left queued for weeks never prints with its old dates", () => {
    expect(isPrintJobStale(new Date("2026-09-28T11:54:00Z"), now)).toBe(true);
    expect(isPrintJobStale(new Date("2026-10-22T09:44:00Z"), now)).toBe(true);
  });
});
