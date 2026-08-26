import { describe, it, expect } from "vitest";
import { coverScale, clampOffset, computeDrawRect } from "./image-crop";

const FRAME = { width: 640, height: 360 }; // 16:9

describe("coverScale", () => {
  it("scales a tall portrait photo up until it covers the width", () => {
    // 1080x1920 into 640x360: width needs 0.593, height needs 0.1875 — the
    // larger wins, or the sides would be empty.
    expect(coverScale({ width: 1080, height: 1920 }, FRAME)).toBeCloseTo(640 / 1080);
  });

  it("scales a wide panorama until it covers the height", () => {
    expect(coverScale({ width: 4000, height: 1000 }, FRAME)).toBeCloseTo(360 / 1000);
  });

  it("leaves an exactly-matching photo alone", () => {
    expect(coverScale({ width: 640, height: 360 }, FRAME)).toBeCloseTo(1);
  });

  it("doesn't divide by zero on a photo that hasn't loaded", () => {
    expect(coverScale({ width: 0, height: 0 }, FRAME)).toBe(1);
  });
});

describe("clampOffset", () => {
  const portrait = { width: 1080, height: 1920 };
  const scale = coverScale(portrait, FRAME);

  it("allows no sideways movement when the photo only just covers the width", () => {
    expect(clampOffset({ x: 500, y: 0 }, portrait, FRAME, scale).x).toBeCloseTo(0);
  });

  it("allows vertical movement on a portrait photo, which is the point", () => {
    const slackY = (portrait.height * scale - FRAME.height) / 2;
    expect(slackY).toBeGreaterThan(100);
    expect(clampOffset({ x: 0, y: 50 }, portrait, FRAME, scale).y).toBe(50);
  });

  // The failure this prevents: dragging until the frame shows through.
  it("stops the photo being dragged past its own edge", () => {
    const slackY = (portrait.height * scale - FRAME.height) / 2;
    expect(clampOffset({ x: 0, y: 99999 }, portrait, FRAME, scale).y).toBeCloseTo(slackY);
    expect(clampOffset({ x: 0, y: -99999 }, portrait, FRAME, scale).y).toBeCloseTo(-slackY);
  });

  it("pins an exactly-fitting photo to the centre", () => {
    const exact = { width: 640, height: 360 };
    const pinned = clampOffset({ x: 40, y: -40 }, exact, FRAME, 1);
    // Checked per-axis: clamping a negative to zero yields -0, which reads
    // the same everywhere it's used but isn't deeply equal to 0.
    expect(pinned.x).toBeCloseTo(0);
    expect(pinned.y).toBeCloseTo(0);
  });

  it("gives more room to move as the photo is zoomed in", () => {
    const tight = clampOffset({ x: 9999, y: 0 }, { width: 640, height: 360 }, FRAME, 1).x;
    const zoomed = clampOffset({ x: 9999, y: 0 }, { width: 640, height: 360 }, FRAME, 2).x;
    expect(tight).toBe(0);
    expect(zoomed).toBeGreaterThan(tight);
  });
});

describe("computeDrawRect", () => {
  it("fills the output exactly when the photo matches the frame", () => {
    const rect = computeDrawRect({ width: 640, height: 360 }, FRAME, 1, { x: 0, y: 0 }, 1600);
    expect(rect.dx).toBeCloseTo(0);
    expect(rect.dy).toBeCloseTo(0);
    expect(rect.dw).toBeCloseTo(1600);
    expect(rect.dh).toBeCloseTo(900);
  });

  // The output canvas is bigger than the on-screen frame, so what the host
  // lined up must scale with it or the saved crop won't match the preview.
  it("scales the on-screen position up to the output size", () => {
    const rect = computeDrawRect({ width: 640, height: 360 }, FRAME, 1, { x: 32, y: 0 }, 1600);
    expect(rect.dx).toBeCloseTo(32 * (1600 / 640));
  });

  it("centres a covered portrait photo, overhanging top and bottom equally", () => {
    const portrait = { width: 1080, height: 1920 };
    const scale = coverScale(portrait, FRAME);
    const rect = computeDrawRect(portrait, FRAME, scale, { x: 0, y: 0 }, 1600);
    expect(rect.dx).toBeCloseTo(0);
    expect(rect.dw).toBeCloseTo(1600);
    expect(rect.dh).toBeGreaterThan(900);
    expect(rect.dy).toBeCloseTo((900 - rect.dh) / 2);
  });

  it("moves the crop window when the photo is dragged", () => {
    const portrait = { width: 1080, height: 1920 };
    const scale = coverScale(portrait, FRAME);
    const centred = computeDrawRect(portrait, FRAME, scale, { x: 0, y: 0 }, 1600);
    const draggedDown = computeDrawRect(portrait, FRAME, scale, { x: 0, y: 60 }, 1600);
    expect(draggedDown.dy).toBeGreaterThan(centred.dy);
  });
});
