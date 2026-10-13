import { describe, expect, it } from "vitest";
import {
  FADE_CYCLE_MS,
  FADE_DEFAULT_ASPECT,
  FADE_HOLD_MS,
  FADE_MAX_ASPECT,
  FADE_MIN_ASPECT,
  FADE_TRANSITION_MS,
  fadeFrameAspect,
  fadeReducer,
  fadeRunning,
  initialFadeState,
  pickFadePair,
  showPausedChip,
  visibleSide,
  type FadeEvent,
  type FadeMediaItem,
  type FadeState,
} from "./before-after-fade";

const img = (id: number, phase: FadeMediaItem["phase"]): FadeMediaItem => ({ id, kind: "image", phase });
const vid = (id: number, phase: FadeMediaItem["phase"]): FadeMediaItem => ({ id, kind: "video", phase });
const run = (s: FadeState, ...events: FadeEvent[]) => events.reduce(fadeReducer, s);

describe("timing", () => {
  it("holds each photo about 3 s with a 0.8 s fade, and loops on that cycle", () => {
    expect(FADE_HOLD_MS).toBe(3000);
    expect(FADE_TRANSITION_MS).toBe(800);
    expect(FADE_CYCLE_MS).toBe(3800);
  });
});

describe("pickFadePair", () => {
  it("pairs a before photo with an after photo", () => {
    expect(pickFadePair([img(1, "before"), img(2, "after")])).toEqual({ before: img(1, "before"), after: img(2, "after") });
  });

  it("is null with only one side", () => {
    expect(pickFadePair([img(1, "before")])).toBeNull();
    expect(pickFadePair([img(2, "after")])).toBeNull();
    expect(pickFadePair([])).toBeNull();
    expect(pickFadePair(undefined)).toBeNull();
  });

  it("treats an unphased (pre-split) photo as a before", () => {
    expect(pickFadePair([img(1, null), img(2, "after")])?.before.id).toBe(1);
  });

  it("uses the newest of each side, like the stitched clip", () => {
    const pair = pickFadePair([img(1, "before"), img(5, "before"), img(3, "after"), img(9, "after"), img(4, "before")]);
    expect(pair?.before.id).toBe(5);
    expect(pair?.after.id).toBe(9);
  });

  it("ignores the stitched clip", () => {
    expect(pickFadePair([vid(10, "stitched"), img(1, "before"), img(2, "after")])?.after.id).toBe(2);
  });

  it("is null when the newest of either side is a video", () => {
    expect(pickFadePair([img(1, "before"), vid(2, "after")])).toBeNull();
    expect(pickFadePair([img(1, "before"), vid(3, "before"), img(2, "after")])).toBeNull();
  });

  it("still pairs photos when an older video was re-shot as a photo", () => {
    expect(pickFadePair([vid(1, "before"), img(4, "before"), img(2, "after")])?.before.id).toBe(4);
  });
});

describe("fadeFrameAspect", () => {
  it("follows the photo's own shape", () => {
    expect(fadeFrameAspect(4032, 3024)).toBeCloseTo(4 / 3);
    expect(fadeFrameAspect(3024, 4032)).toBeCloseTo(3 / 4);
  });

  it("clamps very tall and very wide photos", () => {
    expect(fadeFrameAspect(1000, 4000)).toBe(FADE_MIN_ASPECT);
    expect(fadeFrameAspect(4000, 1000)).toBe(FADE_MAX_ASPECT);
  });

  it("uses a default until the photo has loaded", () => {
    expect(fadeFrameAspect(undefined, undefined)).toBe(FADE_DEFAULT_ASPECT);
    expect(fadeFrameAspect(0, 0)).toBe(FADE_DEFAULT_ASPECT);
  });
});

describe("fadeReducer — looping", () => {
  it("starts on the before and flips back and forth forever", () => {
    let s = initialFadeState(false);
    expect(visibleSide(s)).toBe("before");
    const seen: string[] = [];
    for (let i = 0; i < 10; i++) {
      s = fadeReducer(s, { type: "tick" });
      seen.push(visibleSide(s));
    }
    expect(seen).toEqual(["after", "before", "after", "before", "after", "before", "after", "before", "after", "before"]);
    expect(fadeRunning(s)).toBe(true);
  });
});

describe("fadeReducer — tap to pause", () => {
  it("a tap pauses on the current photo and shows the paused chip", () => {
    const s = run(initialFadeState(false), { type: "tick" }, { type: "tap" });
    expect(s.paused).toBe(true);
    expect(visibleSide(s)).toBe("after");
    expect(showPausedChip(s)).toBe(true);
    expect(fadeRunning(s)).toBe(false);
    expect(visibleSide(fadeReducer(s, { type: "tick" }))).toBe("after");
  });

  it("a second tap plays again", () => {
    const s = run(initialFadeState(false), { type: "tap" }, { type: "tap" });
    expect(s.paused).toBe(false);
    expect(showPausedChip(s)).toBe(false);
    expect(visibleSide(fadeReducer(s, { type: "tick" }))).toBe("after");
  });
});

describe("fadeReducer — hold to compare", () => {
  it("shows the other photo while held, and stops the loop", () => {
    const s = run(initialFadeState(false), { type: "holdStart" });
    expect(visibleSide(s)).toBe("after");
    expect(fadeRunning(s)).toBe(false);
    expect(showPausedChip(s)).toBe(false);
    expect(fadeReducer(s, { type: "tick" })).toBe(s);
  });

  it("lets go back to where it was, still playing", () => {
    const s = run(initialFadeState(false), { type: "holdStart" }, { type: "holdEnd" });
    expect(visibleSide(s)).toBe("before");
    expect(fadeRunning(s)).toBe(true);
  });

  it("works while paused, and stays paused afterwards", () => {
    const s = run(initialFadeState(false), { type: "tap" }, { type: "holdStart" });
    expect(visibleSide(s)).toBe("after");
    const after = fadeReducer(s, { type: "holdEnd" });
    expect(visibleSide(after)).toBe("before");
    expect(after.paused).toBe(true);
  });
});

describe("fadeReducer — Before | After buttons", () => {
  it("shows the chosen side and holds it there", () => {
    const s = run(initialFadeState(false), { type: "show", side: "after" });
    expect(visibleSide(s)).toBe("after");
    expect(s.paused).toBe(true);
    expect(showPausedChip(s)).toBe(true);
    expect(visibleSide(fadeReducer(s, { type: "tick" }))).toBe("after");
  });
});

describe("fadeReducer — reduced motion", () => {
  it("never loops", () => {
    const s = initialFadeState(true);
    expect(fadeRunning(s)).toBe(false);
    expect(fadeReducer(s, { type: "tick" })).toBe(s);
  });

  it("buttons switch sides, with no paused chip", () => {
    const s = run(initialFadeState(true), { type: "show", side: "after" });
    expect(visibleSide(s)).toBe("after");
    expect(showPausedChip(s)).toBe(false);
  });

  it("a tap flips instead of pausing", () => {
    const s = run(initialFadeState(true), { type: "tap" });
    expect(visibleSide(s)).toBe("after");
    expect(s.paused).toBe(false);
  });

  it("switching the setting on and off mid-way", () => {
    const off = run(initialFadeState(false), { type: "tap" }, { type: "setAuto", auto: false });
    expect(fadeRunning(off)).toBe(false);
    expect(showPausedChip(off)).toBe(false);
    const on = fadeReducer(off, { type: "setAuto", auto: true });
    expect(fadeRunning(on)).toBe(true);
  });
});
