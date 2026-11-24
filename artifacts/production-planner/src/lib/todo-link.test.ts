import { describe, expect, it } from "vitest";
import { resolveTodoLink, taskLink } from "./todo-link";

describe("resolveTodoLink", () => {
  // Regression: the lean review-ahead task stores "/lean-review?week=next".
  // The old LinkButton prefixed https:// onto it, so the browser looked up
  // "lean-review" as a hostname and died with DNS_PROBE_FINISHED_NXDOMAIN.
  it("keeps app-relative paths relative and in the same tab", () => {
    expect(resolveTodoLink("/lean-review?week=next")).toEqual({
      href: "/lean-review?week=next",
      label: "lean-review",
      external: false,
    });
  });

  it("labels app paths without query, hash, or leading slashes", () => {
    expect(resolveTodoLink("/founder/numbers#p-and-l").label).toBe("founder/numbers");
    expect(resolveTodoLink("/").label).toBe("this app");
  });

  it("passes full external URLs through untouched", () => {
    expect(resolveTodoLink("https://www.supplier.co.uk/orders?id=9")).toEqual({
      href: "https://www.supplier.co.uk/orders?id=9",
      label: "supplier.co.uk",
      external: true,
    });
  });

  it("adds https:// to bare external domains", () => {
    expect(resolveTodoLink("supplier.co.uk/orders")).toEqual({
      href: "https://supplier.co.uk/orders",
      label: "supplier.co.uk",
      external: true,
    });
  });

  it("trims surrounding whitespace before deciding", () => {
    expect(resolveTodoLink("  /lean-review  ").external).toBe(false);
  });

  it("a test request's to-do opens the test, and says so", () => {
    expect(resolveTodoLink("/?testRequest=12")).toEqual({ href: "/?testRequest=12", label: "the test", external: false });
  });
});

describe("taskLink", () => {
  it("sends a weekly lean to-do to its own week, so a missed week can be done late", () => {
    expect(taskLink({ url: "/lean-review", lean_week_start: "2026-11-10" })).toBe("/lean-review?week=2026-11-10");
    expect(taskLink({ url: "/lean-review?week=2026-11-17", lean_week_start: "2026-11-17" })).toBe("/lean-review?week=2026-11-17");
    expect(taskLink({ url: "/lean-review?week=next", lean_week_start: "2026-12-01" })).toBe("/lean-review?week=next");
  });
  it("leaves other links alone", () => {
    expect(taskLink({ url: "/orders", lean_week_start: null })).toBe("/orders");
    expect(taskLink({ url: null })).toBeNull();
  });
});
