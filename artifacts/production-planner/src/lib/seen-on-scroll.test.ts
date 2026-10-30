import { describe, expect, it } from "vitest";
import {
  IN_VIEW_DWELL_MS, SEEN_DWELL_MS, isInView, isLookedAt, isScrolledPast, newSeenTracker, stepSeen,
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

  it("a tall photo card (taller than the screen) read while scrolling through it counts once its end has been in view a while", () => {
    // 1400 px card scrolled through at reading pace, 100 px a second.
    const steps: Array<[number, number]> = [];
    for (let i = 0; i <= 20; i++) steps.push([i * 1000, 600 - i * 100]);
    const seenAt = play(1400, steps);
    // Its bottom comes on screen at step 12 (top + 1400 ≤ 844) and stays in
    // the lower half of the screen; IN_VIEW_DWELL_MS later it counts.
    expect(seenAt).toBe(12 * 1000 + IN_VIEW_DWELL_MS);
  });

  it("a fast flick past never counts", () => {
    expect(play(300, [[0, 900], [60, 600], [120, 300], [180, 0], [240, -300], [300, -900], [4000, -900]])).toBeNull();
  });

  it("read but scrolled back UP (card below the screen again) doesn't count", () => {
    expect(play(300, [[0, 300], [2000, 300], [2200, 900], [8000, 900]])).toBeNull();
  });

  // 30 Oct bug: stopping to read a card — all of it on screen — did nothing
  // until you scrolled on past it.
  it("stopping on a card mid-feed, all of it in view, counts after IN_VIEW_DWELL_MS — no scrolling needed", () => {
    expect(play(300, [[0, 300], [10_000, 300]])).toBe(IN_VIEW_DWELL_MS);
  });

  it("a card already fully in view when the page opens counts after IN_VIEW_DWELL_MS", () => {
    expect(play(300, [[0, 20], [6000, 20]])).toBe(IN_VIEW_DWELL_MS);
  });

  it("the clock restarts if the card leaves view before the time is up", () => {
    // In view 2 s, scrolled back down so it's below the screen, back for 2 s: not yet.
    expect(play(300, [[0, 300], [2000, 900], [2500, 300], [4500, 300]])).toBeNull();
    // …then a full unbroken stretch counts.
    expect(play(300, [[0, 300], [2000, 900], [2500, 300], [8000, 300]])).toBe(2500 + IN_VIEW_DWELL_MS);
  });

  it("only its top showing (bottom still below the screen) doesn't count, however long", () => {
    expect(play(300, [[0, 700], [10_000, 700]])).toBeNull();
  });

  it("a card taller than the screen counts once its bottom has come up into view and stays there", () => {
    // 1400 px photo card: top of it on screen (bottom below) for ages — no.
    expect(play(1400, [[0, 100], [10_000, 100]])).toBeNull();
    // Scrolled until its bottom is 200 px above the bottom of the screen.
    const bottomUp = ROOT_H - 200 - 1400;
    expect(play(1400, [[0, 100], [5000, bottomUp], [10_000, bottomUp]])).toBe(5000 + IN_VIEW_DWELL_MS);
  });

  it("iPad portrait and landscape: a fully visible card counts at IN_VIEW_DWELL_MS", () => {
    for (const rootH of [1080 - 56, 810 - 56]) {
      let t = newSeenTracker();
      let seenAt: number | null = null;
      for (let now = 0; now <= 5000 && seenAt == null; now += 250) {
        const r = stepSeen(t, { now, cardTop: 56 + 100, cardBottom: 56 + 600, rootTop: 56, rootBottom: 56 + rootH, atEnd: false });
        t = r.tracker;
        if (r.seen) seenAt = now;
      }
      expect(seenAt).toBe(IN_VIEW_DWELL_MS);
    }
  });

  it("the last card, which can't scroll past, counts once its end has been in view for IN_VIEW_DWELL_MS", () => {
    // Feed hits its end with the card part-way up, end showing (iPad: 287 px of 720 left).
    const seenAt = play(720, [[0, 900], [300, 400], [600, -432, true], [8000, -432, true]]);
    expect(seenAt).toBe(600 + IN_VIEW_DWELL_MS);
  });

  it("…but not if you only glance at the end of the feed", () => {
    expect(play(300, [[0, 300, true], [IN_VIEW_DWELL_MS - 500, 300, true]])).toBeNull();
  });

  it("a short feed that never scrolls counts the cards on screen", () => {
    expect(play(300, [[0, 100, true], [5000, 100, true]])).toBe(IN_VIEW_DWELL_MS);
  });

  it("isInView: bottom on screen and enough of it showing", () => {
    const base = { now: 0, rootTop: 0, rootBottom: 800, atEnd: false };
    expect(isInView({ ...base, cardTop: 100, cardBottom: 400 })).toBe(true); // whole card
    expect(isInView({ ...base, cardTop: 600, cardBottom: 900 })).toBe(false); // bottom below the screen
    expect(isInView({ ...base, cardTop: -100, cardBottom: 200 })).toBe(true); // two thirds, end showing
    expect(isInView({ ...base, cardTop: -250, cardBottom: 50 })).toBe(false); // just a sliver
    expect(isInView({ ...base, cardTop: -250, cardBottom: 50, atEnd: true })).toBe(false);
    expect(isInView({ ...base, cardTop: -200, cardBottom: 100, atEnd: true })).toBe(true); // end of feed: a third is enough
    expect(isInView({ ...base, cardTop: -1000, cardBottom: 500 })).toBe(true); // tall card, bottom low on screen
    expect(isInView({ ...base, cardTop: -1300, cardBottom: 200 })).toBe(false); // tall card, scrolled mostly away
    expect(isInView({ ...base, cardTop: 100, cardBottom: 400, hidden: true })).toBe(false);
  });

  it("nothing counts while the tab is in the background", () => {
    let t = newSeenTracker();
    for (let now = 0; now <= 5000; now += 250) {
      const r = stepSeen(t, { now, cardTop: 100, cardBottom: 400, rootTop: 56, rootBottom: 900, atEnd: true, hidden: true });
      expect(r.seen).toBe(false);
      t = r.tracker;
    }
    expect(t.dwellMs).toBe(0);
    expect(t.inViewSince).toBeNull();
  });

  it("hiding the tab restarts the in-view clock", () => {
    let t = newSeenTracker();
    const at = (now: number, hidden: boolean) => {
      const r = stepSeen(t, { now, cardTop: 100, cardBottom: 400, rootTop: 56, rootBottom: 900, atEnd: false, hidden });
      t = r.tracker;
      return r.seen;
    };
    expect(at(0, false)).toBe(false);
    expect(at(2000, false)).toBe(false);
    expect(at(2500, true)).toBe(false); // switched away
    expect(at(10_000, false)).toBe(false); // back: the clock starts again here
    expect(at(12_000, false)).toBe(false);
    expect(at(10_000 + IN_VIEW_DWELL_MS, false)).toBe(true);
  });

  it("the dwell is SEEN_DWELL_MS: just under it then scrolled past doesn't count, just over does", () => {
    const run = (readMs: number) => play(300, [[0, 300], [readMs, -400], [readMs + 2000, -400]], { tickMs: 50 });
    expect(run(SEEN_DWELL_MS - 100)).toBeNull();
    expect(run(SEEN_DWELL_MS + 100)).not.toBeNull();
  });
});
