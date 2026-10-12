import { describe, it, expect } from "vitest";
import { shouldPingKeepAlive, KEEP_ALIVE_EVERY_MS } from "./use-people-keep-alive";

describe("People keep-alive while typing", () => {
  it("pings on the first keystroke, then at most every few minutes", () => {
    expect(shouldPingKeepAlive(null, 1000)).toBe(true);
    expect(shouldPingKeepAlive(1000, 1000 + KEEP_ALIVE_EVERY_MS - 1)).toBe(false);
    expect(shouldPingKeepAlive(1000, 1000 + KEEP_ALIVE_EVERY_MS)).toBe(true);
  });
  it("stays well inside the server's 15-minute window", () => {
    expect(KEEP_ALIVE_EVERY_MS).toBeLessThan(15 * 60 * 1000 / 2);
  });
});
