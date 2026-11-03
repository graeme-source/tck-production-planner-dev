/**
 * A read cache that lives for ONE request (Fix queue #376).
 *
 * The recipe and sub-recipe resolver reads a recipe's lines one query at a
 * time, and a heavy page resolves the same recipe or sub-recipe (dough,
 * bases, sauces) dozens of times — the Orders page's /calculate made
 * hundreds of identical reads. Inside a request wrapped with
 * `readCacheMiddleware` (or `withReadCache`), `readThrough(key, load)`
 * runs each distinct read once and hands every later caller the same rows.
 * Outside one it just runs `load()`, so every other caller is unchanged.
 *
 * Only cache raw rows that callers never mutate (they map them into fresh
 * objects), and only reads whose answer can't change mid-request.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";

const store = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

export function withReadCache<T>(fn: () => T): T {
  return store.run(new Map(), fn);
}

/** Express middleware: the rest of this request shares one read cache. */
export const readCacheMiddleware: RequestHandler = (_req, _res, next) => {
  withReadCache(() => next());
};

/** `load()` once per key per request. The load may return a thenable
 *  (a Drizzle query builder): it is turned into a real promise straight
 *  away so the query runs exactly once. */
export function readThrough<T>(key: string, load: () => PromiseLike<T>): Promise<T> {
  const cache = store.getStore();
  if (!cache) return Promise.resolve(load());
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = Promise.resolve(load());
    cache.set(key, p);
  }
  return p;
}
