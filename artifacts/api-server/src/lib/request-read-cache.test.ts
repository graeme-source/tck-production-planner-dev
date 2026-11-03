import { describe, expect, it } from "vitest";
import { readThrough, withReadCache } from "./request-read-cache";

/** A Drizzle-like thenable that counts how often it is executed. */
function fakeQuery(rows: unknown[], counter: { runs: number }): PromiseLike<unknown[]> {
  return {
    then(onFulfilled, onRejected) {
      counter.runs++;
      return Promise.resolve(rows).then(onFulfilled, onRejected);
    },
  };
}

describe("readThrough (Fix queue #376)", () => {
  it("runs each read once per request and shares the rows", async () => {
    const counter = { runs: 0 };
    const rows = [{ id: 1 }];
    await withReadCache(async () => {
      const a = await readThrough("sub:4", () => fakeQuery(rows, counter));
      const [b, c] = await Promise.all([
        readThrough("sub:4", () => fakeQuery(rows, counter)),
        readThrough("sub:4", () => fakeQuery(rows, counter)),
      ]);
      await readThrough("sub:5", () => fakeQuery(rows, counter));
      expect(a).toBe(rows);
      expect(b).toBe(rows);
      expect(c).toBe(rows);
    });
    expect(counter.runs).toBe(2);
  });

  it("does not cache outside a request that opted in, nor across requests", async () => {
    const counter = { runs: 0 };
    await readThrough("sub:4", () => fakeQuery([], counter));
    await readThrough("sub:4", () => fakeQuery([], counter));
    await withReadCache(() => readThrough("sub:4", () => fakeQuery([], counter)));
    await withReadCache(() => readThrough("sub:4", () => fakeQuery([], counter)));
    expect(counter.runs).toBe(4);
  });
});
