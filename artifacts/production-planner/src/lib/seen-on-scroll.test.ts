import { describe, expect, it } from "vitest";
import {
  END_OF_FEED_DWELL_MS, SEEN_DWELL_MS, isLookedAt, isScrolledPast, newSeenTracker, stepSeen,
  type SeenSample, type SeenTracker,
} from "./seen-on-scroll";

// The desktop feed: #app-main-scroll starts 56 px down (under the top bar)
// and is 844 px tall.
const ROOT_TOP = 56;
const ROOT_H = 844;

/** Play a scroll through the rules: each step is [ms since start, the card's
 *  top in the scroll box's coordinates (0 = the box's top edge), atEnd?].
 *  Returns the time at which the card counted as seen, or null. */
function play(cardHeight: number, steps: Array<[number, number, boolean?]>, opts: { tickMs?: number } = {}): number | null {
  let t: SeenTracker = newSeenTracker();
  // Fill in the hook's ¼-second ticks between scroll steps.
  const tick = opts.tickMs ?? 250;
  const samples: Array<[number, number, boolean]> = [];
  steps.forEach(([at, top, atEnd = false], i) => {
    samples.push([at, top, atEnd]);
    const next = steps[i + 1]?.[0] ?? at;
    for (let s = at + tick; s < next; s += tick) samples.push([s, top, atEnd]);
  });
  for (const [now, top, atEnd] of samples) {
    const s: SeenSample = {
      now, cardTop: ROOT_TOP + top, cardBottom: ROOT_TOP + top + cardHeight,
      rootTop: ROOT_TOP, rootBottom: ROOT_TOP + ROOT_H, atEnd,
    };
    const r = stepSeen(t, s);
    t = r.tracker;
    if (r.seen) return now;
  }
  return null;
}

describe("auto 'I've seen this' on scroll", () => {
  it("half a normal card on screen counts as looking at it; a tall one once it fills about half the screen", () => {
    expect(isLookedAt(150, 300, 800)).toBe(true);
    expect(isLookedAt(100, 300, 800)).toBe(false);
    expect(isLookedAt(400, 1600, 800)).toBe(true);
    expect(isLookedAt(300, 1600, 800)).toBe(false);
    expect(isLookedAt(0, 0, 800)).toBe(false);
  });

  it("'past' means its bottom has gone above the top third of the scroll box — not right off the edge", () => {
    expect(isScrolledPast(ROOT_TOP + 200, ROOT_TOP, ROOT_TOP + ROOT_H)).toBe(true); // peeking out at the top
    expect(isScrolledPast(ROOT_TOP - 50, ROOT_TOP, ROOT_TOP + ROOT_H)).toBe(true); // hidden under the top bar (16 Oct bug)
    expect(isScrolledPast(ROOT_TOP + 400, ROOT_TOP, ROOT_TOP + ROOT_H)).toBe(false); // still mid-screen
  });

  it("read, then scrolled on past with mouse-wheel steps (24 Oct report): counts", () => {
    // 300 px card: comes in from the bottom, read for ~2 s, then 100 px
    // wheel steps carry it up; its bottom stops 150 px from the top, still showing.
    const seenAt = play(300, [
      [0, 900], [200, 700], [400, 500], [2400, 400], [2600, 300], [2800, 200], [3000, 100], [3200, -150], [6000, -150],
    ]);
    expect(seenAt).toBe(3200);
  });

  it("a tall photo card (taller than the screen) read while scrolling through it counts once scrolled on", () => {
    // 1400 px card scrolled through at reading pace, 100 px a second.
    const steps: Array<[number, number]> = [];
    for (let i = 0; i <= 20; i++) steps.push([i * 1000, 600 - i * 100]);
    const seenAt = play(1400, steps);
    expect(seenAt).not.toBeNull();
    // Counted once its bottom passed the top third: top + 1400 ≤ ~282, at step 18.
    expect(seenAt).toBe(18 * 1000);
  });

  it("a fast flick past never counts", () => {
    expect(play(300, [[0, 900], [60, 600], [120, 300], [180, 0], [240, -300], [300, -900], [4000, -900]])).toBeNull();
  });

  it("read but scrolled back UP (card below the screen again) doesn't count", () => {
    expect(play(300, [[0, 300], [3000, 300], [3200, 900], [8000, 900]])).toBeNull();
  });

  it("stopping on a card mid-feed doesn't count until you move on", () => {
    expect(play(300, [[0, 300], [10_000, 300]])).toBeNull();
  });

  it("the last card, which can't scroll past, counts after a longer look at the end of the feed", () => {
    // Feed hits its end with the card part-way up, end showing (iPad: 287 px of 720 left).
    const seenAt = play(720, [[0, 900], [300, 400], [600, -432, true], [8000, -432, true]]);
    expect(seenAt).not.toBeNull();
    expect(seenAt!).toBeGreaterThanOrEqual(END_OF_FEED_DWELL_MS);
    expect(seenAt!).toBeLessThan(END_OF_FEED_DWELL_MS + 1200);
  });

  it("…but not if you only glance at the end of the feed", () => {
    expect(play(300, [[0, 300, true], [END_OF_FEED_DWELL_MS - 500, 300, true]])).toBeNull();
  });

  it("a short feed that never scrolls counts the cards on screen after the longer look", () => {
    expect(play(300, [[0, 100, true], [5000, 100, true]])).toBe(END_OF_FEED_DWELL_MS);
  });

  it("nothing counts while the tab is in the background", () => {
    let t = newSeenTracker();
    for (let now = 0; now <= 5000; now += 250) {
      const r = stepSeen(t, { now, cardTop: 100, cardBottom: 400, rootTop: 56, rootBottom: 900, atEnd: true, hidden: true });
      expect(r.seen).toBe(false);
      t = r.tracker;
    }
    expect(t.dwellMs).toBe(0);
  });

  it("the dwell is SEEN_DWELL_MS: just under it then scrolled past doesn't count, just over does", () => {
    const run = (readMs: number) => play(300, [[0, 300], [readMs, -400], [readMs + 2000, -400]], { tickMs: 50 });
    expect(run(SEEN_DWELL_MS - 100)).toBeNull();
    expect(run(SEEN_DWELL_MS + 100)).not.toBeNull();
  });
});
