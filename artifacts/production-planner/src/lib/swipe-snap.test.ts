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
  it("opens once pulled 35% out, springs back short of it", () => {
    expect(snapAfterDrag({ wasOpen: false, progress: 0.36, velocityPxPerMs: 0 })).toBe("open");
    expect(snapAfterDrag({ wasOpen: false, progress: 0.3, velocityPxPerMs: 0 })).toBe("closed");
  });
  it("a fast leftward flick opens it, but only once it's 20% out", () => {
    expect(snapAfterDrag({ wasOpen: false, progress: 0.22, velocityPxPerMs: -0.8 })).toBe("open");
    expect(snapAfterDrag({ wasOpen: false, progress: 0.05, velocityPxPerMs: -0.8 })).toBe("closed");
    // A slow drift doesn't count as a flick.
    expect(snapAfterDrag({ wasOpen: false, progress: 0.25, velocityPxPerMs: -0.2 })).toBe("closed");
  });
  // Regression (Graeme, 2026-10-10): a short drag across a button closed it
  // — or couldn't close it at all. Closing now needs a LONG swipe.
  it("closing needs a long swipe: pushed half way back closes, a third doesn't", () => {
    expect(snapAfterDrag({ wasOpen: true, progress: 0.5, velocityPxPerMs: 0 })).toBe("closed");
    expect(snapAfterDrag({ wasOpen: true, progress: 0.2, velocityPxPerMs: 0 })).toBe("closed");
    expect(snapAfterDrag({ wasOpen: true, progress: 0.6, velocityPxPerMs: 0 })).toBe("open");
    expect(snapAfterDrag({ wasOpen: true, progress: 0.66, velocityPxPerMs: 0.2 })).toBe("open");
  });
  it("an accidental quick flick doesn't close it — the flick must also travel 30%", () => {
    expect(snapAfterDrag({ wasOpen: true, progress: 0.95, velocityPxPerMs: 0.9 })).toBe("open");
    expect(snapAfterDrag({ wasOpen: true, progress: 0.75, velocityPxPerMs: 0.9 })).toBe("open");
    expect(snapAfterDrag({ wasOpen: true, progress: 0.69, velocityPxPerMs: 0.9 })).toBe("closed");
  });
  it("a flick back the other way cancels", () => {
    expect(snapAfterDrag({ wasOpen: true, progress: 0.4, velocityPxPerMs: -0.8 })).toBe("open");
    expect(snapAfterDrag({ wasOpen: false, progress: 0.6, velocityPxPerMs: 0.8 })).toBe("closed");
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
