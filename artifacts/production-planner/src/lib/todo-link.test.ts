import { describe, expect, it } from "vitest";
import { resolveTodoLink } from "./todo-link";

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
});
