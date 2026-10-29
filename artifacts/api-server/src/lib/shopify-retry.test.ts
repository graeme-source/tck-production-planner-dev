import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetShopifyPause, isRetryable, retryWaitMs, withShopifyRetry, type RetryClock } from "./shopify-retry";

function fakeClock(): RetryClock & { t: number } {
  const c = { t: 0, now: () => c.t, sleep: async (ms: number) => { c.t += ms; } };
  return c;
}
const resp = (status: number, headers: Record<string, string> = {}) => new Response(status === 204 ? null : "{}", { status, headers });

beforeEach(() => {
  _resetShopifyPause();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("withShopifyRetry — #138515: a 429 must not fail a fulfilment", () => {
  it("keeps going through 429s and returns the success", async () => {
    const clock = fakeClock();
    const send = vi.fn()
      .mockResolvedValueOnce(resp(429))
      .mockResolvedValueOnce(resp(429, { "Retry-After": "2" }))
      .mockResolvedValueOnce(resp(200));
    const res = await withShopifyRetry("GET /orders/1.json", true, send, clock);
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(3);
    expect(clock.t).toBe(1000 + 2000);
  });

  it("retries a write on 429 (Shopify did nothing) but never on a 500 (it might have)", async () => {
    const clock = fakeClock();
    const send = vi.fn().mockResolvedValueOnce(resp(429)).mockResolvedValueOnce(resp(500));
    const res = await withShopifyRetry("POST /fulfillments.json", false, send, clock);
    expect(res.status).toBe(500);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("retries reads through 5xx and dropped connections", async () => {
    const clock = fakeClock();
    const send = vi.fn().mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(resp(503)).mockResolvedValueOnce(resp(200));
    expect((await withShopifyRetry("GET x", true, send, clock)).status).toBe(200);
  });

  it("gives up after about 2 minutes and hands back the last answer", async () => {
    const clock = fakeClock();
    const send = vi.fn().mockImplementation(async () => resp(429));
    const res = await withShopifyRetry("GET x", true, send, clock);
    expect(res.status).toBe(429);
    expect(clock.t).toBeLessThanOrEqual(120_000);
    expect(clock.t).toBeGreaterThan(100_000);
  });

  it("returns a 404 straight away — not a busy signal", async () => {
    const send = vi.fn().mockResolvedValue(resp(404));
    expect((await withShopifyRetry("GET x", true, send, fakeClock())).status).toBe(404);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("retry rules", () => {
  it("waits as Shopify asks, else 1s, 2s, 4s… up to 10s", () => {
    expect(retryWaitMs(1, "3")).toBe(3000);
    expect(retryWaitMs(1, null)).toBe(1000);
    expect(retryWaitMs(3, null)).toBe(4000);
    expect(retryWaitMs(9, null)).toBe(10_000);
  });
  it("only busy / broken answers are retried", () => {
    expect(isRetryable({ status: 429 }, false)).toBe(true);
    expect(isRetryable({ status: 502 }, false)).toBe(false);
    expect(isRetryable({ status: 502 }, true)).toBe(true);
    expect(isRetryable({ status: 422 }, true)).toBe(false);
    expect(isRetryable(null, false)).toBe(false);
  });
});
