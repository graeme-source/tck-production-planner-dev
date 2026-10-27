import { describe, it, expect } from "vitest";
import { smallestField } from "./label-smallest-field";

describe("smallestField", () => {
  it("picks the smallest text on a back label", () => {
    expect(smallestField([{ key: "title", sizePt: 22 }, { key: "ingredients", sizePt: 7 }, { key: "dates", sizePt: 9 }])?.key).toBe("ingredients");
  });
  it("is null for a small label with no field table (regression: publish crashed)", () => {
    expect(smallestField([])).toBeNull();
  });
});
