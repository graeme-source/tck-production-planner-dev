import { describe, it, expect } from "vitest";
import { dragProgress, isTap, panelWidth, releaseVelocity, snapAfterDrag } from "./swipe-snap";

describe("dragProgress", () => {
  it("follows the finger: dragging left opens, right closes, clamped 0–1", () => {
    expect(dragProgress(0, -300, 900)).toBeCloseTo(1 / 3);
    expect(dragProgress(1, 450, 900)).toBeCloseTo(0.5);
    expect(dragProgress(0, 200, 900)).toBe(0);
    expect(dragProgress(0, -2000, 900)).toBe(1);
  });
});

describe("snapAfterDrag", () => {
  it("opens once dragged a third of the way out, springs back short of it", () => {
    expect(snapAfterDrag({ wasOpen: false, progress: 0.34, velocityPxPerMs: 0 })).toBe("open");
    expect(snapAfterDrag({ wasOpen: false, progress: 0.3, velocityPxPerMs: 0 })).toBe("closed");
  });
  it("closes once pushed a third of the way back, stays open short of it", () => {
    expect(snapAfterDrag({ wasOpen: true, progress: 0.6, velocityPxPerMs: 0 })).toBe("closed");
    expect(snapAfterDrag({ wasOpen: true, progress: 0.7, velocityPxPerMs: 0 })).toBe("open");
  });
  it("a fast flick wins either way", () => {
    expect(snapAfterDrag({ wasOpen: false, progress: 0.05, velocityPxPerMs: -0.8 })).toBe("open");
    expect(snapAfterDrag({ wasOpen: true, progress: 0.95, velocityPxPerMs: 0.8 })).toBe("closed");
    // A slow drift doesn't count as a flick.
    expect(snapAfterDrag({ wasOpen: false, progress: 0.1, velocityPxPerMs: -0.2 })).toBe("closed");
  });
});

describe("isTap", () => {
  it("treats a press that barely moves as a tap", () => {
    expect(isTap(3)).toBe(true);
    expect(isTap(-7)).toBe(true);
    expect(isTap(12)).toBe(false);
  });
});

describe("releaseVelocity", () => {
  it("uses the last ~100 ms, so a final flick counts", () => {
    const samples = [{ x: 500, t: 0 }, { x: 495, t: 300 }, { x: 490, t: 600 }, { x: 400, t: 650 }, { x: 340, t: 680 }];
    expect(releaseVelocity(samples)).toBeCloseTo((340 - 490) / 80);
    expect(releaseVelocity([{ x: 1, t: 0 }])).toBe(0);
  });
});

describe("panelWidth", () => {
  it("is the full width on a phone and 85% on an iPad", () => {
    expect(panelWidth(390)).toBe(390);
    expect(panelWidth(1080)).toBe(918);
  });
});
