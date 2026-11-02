import { describe, expect, it } from "vitest";
import { TOP_BAR_ACTIONS_CLASS, TOP_BAR_CLASS } from "./top-bar-layout";

const classes = (s: string) => s.split(/\s+/);

// #359: Add Ingredient vanished off the right of the iPad top bar.
describe("top bar never clips the page's own buttons", () => {
  it("lets the bar wrap onto a second row", () => {
    expect(classes(TOP_BAR_CLASS)).toContain("flex-wrap");
    expect(classes(TOP_BAR_CLASS)).not.toContain("flex-nowrap");
  });

  it("keeps the page's buttons right-aligned and no wider than the bar", () => {
    expect(classes(TOP_BAR_ACTIONS_CLASS)).toEqual(expect.arrayContaining(["ml-auto", "max-w-full", "min-w-0"]));
  });

  it("lets a page's button group wrap inside its row", () => {
    expect(classes(TOP_BAR_ACTIONS_CLASS)).toEqual(expect.arrayContaining(["[&>*]:flex-wrap", "[&>*]:justify-end"]));
  });

  it("does not shrink-lock the actions (that is what pushed them off the edge)", () => {
    expect(classes(TOP_BAR_ACTIONS_CLASS)).not.toContain("flex-shrink-0");
  });
});
