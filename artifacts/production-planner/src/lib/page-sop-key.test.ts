import { describe, it, expect } from "vitest";
import { pageSopKey } from "./page-sop-key";

describe("pageSopKey", () => {
  it("plain routes are their own key", () => {
    expect(pageSopKey("/fulfilment")).toBe("/fulfilment");
    expect(pageSopKey("/inventory/tools")).toBe("/inventory/tools");
  });

  it("the dashboard root stays '/'", () => {
    expect(pageSopKey("/")).toBe("/");
    expect(pageSopKey("")).toBe("/");
  });

  it("numeric id segments collapse so every plan shares one page", () => {
    expect(pageSopKey("/plans/123/station/packing")).toBe("/plans/*/station/packing");
    expect(pageSopKey("/plans/456/station/packing")).toBe("/plans/*/station/packing");
    expect(pageSopKey("/documents/8")).toBe("/documents/*");
  });

  it("named segments containing digits are NOT ids", () => {
    expect(pageSopKey("/lean-review")).toBe("/lean-review");
    expect(pageSopKey("/v2/thing")).toBe("/v2/thing");
  });

  it("query strings and hashes are views of a page, not pages", () => {
    expect(pageSopKey("/fulfilment?tag=2026-09-10")).toBe("/fulfilment");
    expect(pageSopKey("/inventory?tab=ingredients")).toBe("/inventory");
    expect(pageSopKey("/hub#training")).toBe("/hub");
  });

  it("trailing slashes don't make a second page", () => {
    expect(pageSopKey("/fulfilment/")).toBe("/fulfilment");
  });
});
