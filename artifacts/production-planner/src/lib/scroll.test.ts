import { describe, expect, it } from "vitest";
import { resetScrollWithin, type ScrollableLike } from "./scroll";

describe("resetScrollWithin", () => {
  it("puts the slide body and anything scrolled inside it back at the top", () => {
    const nested: ScrollableLike = { scrollTop: 240 };
    const untouched: ScrollableLike = { scrollTop: 0 };
    const body: ScrollableLike = { scrollTop: 900, querySelectorAll: () => [nested, untouched] };
    resetScrollWithin(body);
    expect(body.scrollTop).toBe(0);
    expect(nested.scrollTop).toBe(0);
    expect(untouched.scrollTop).toBe(0);
  });

  it("copes with no element yet", () => {
    expect(() => resetScrollWithin(null)).not.toThrow();
  });
});
