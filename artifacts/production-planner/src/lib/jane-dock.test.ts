import { describe, expect, it } from "vitest";
import { janeDockWidth } from "./jane-dock";

describe("janeDockWidth", () => {
  it("docks on a desktop, wider on a big screen", () => {
    expect(janeDockWidth(1280)).toBe(440);
    expect(janeDockWidth(1920)).toBe(500);
  });

  it("slides over the page on an iPad or phone, where the page can't lose the width", () => {
    expect(janeDockWidth(1080)).toBeNull();
    expect(janeDockWidth(810)).toBeNull();
    expect(janeDockWidth(390)).toBeNull();
  });

  it("counts a team list dock against the room", () => {
    expect(janeDockWidth(1440, 360)).toBeNull();
    expect(janeDockWidth(1920, 360)).toBe(440);
  });
});
