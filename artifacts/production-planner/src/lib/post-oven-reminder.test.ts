import { describe, it, expect } from "vitest";
import { decidePostOvenReminder } from "./post-oven-reminder";

const GARLIC = 7;
const PLAIN = 8;
const OTHER = 9;
const postOven: Record<number, number> = { [GARLIC]: 1, [PLAIN]: 0, [OTHER]: 0 };

/** Replays a sequence of selections the way the station effect sees them,
 *  returning which checks showed the reminder. */
function replay(selections: Array<number | null>, counts: Record<number, number> = postOven): boolean[] {
  let remindedForId: number | null = null;
  return selections.map((selectedItemId) => {
    const d = decidePostOvenReminder({
      selectedItemId,
      postOvenCount: selectedItemId != null ? (counts[selectedItemId] ?? 0) : 0,
      remindedForId,
    });
    remindedForId = d.remindedForId;
    return d.show;
  });
}

describe("decidePostOvenReminder", () => {
  it("fires for a post-oven recipe that just came on show — the auto-select regression", () => {
    // 2026-09-17: garlic recipe first in the queue auto-selected and the
    // reminder never showed. The rule must not care HOW it came on show.
    expect(decidePostOvenReminder({ selectedItemId: GARLIC, postOvenCount: 1, remindedForId: null }).show).toBe(true);
  });

  it("stays quiet for recipes without post-oven items", () => {
    expect(replay([PLAIN, OTHER])).toEqual([false, false]);
  });

  it("does nothing when no recipe is on show", () => {
    expect(replay([null])).toEqual([false]);
  });

  it("skip past it then press Prev to go back → shows again (Jane Miles, 2026-09-17)", () => {
    expect(replay([GARLIC, PLAIN, GARLIC])).toEqual([true, false, true]);
  });

  it("staying on it across re-renders and refetches → shows once", () => {
    expect(replay([GARLIC, GARLIC, GARLIC, GARLIC])).toEqual([true, false, false, false]);
  });

  it("returning after visiting several other recipes → shows again, every time", () => {
    expect(replay([GARLIC, GARLIC, PLAIN, OTHER, OTHER, GARLIC, GARLIC, PLAIN, GARLIC]))
      .toEqual([true, false, false, false, false, true, false, false, true]);
  });

  it("post-oven data arriving after the auto-select still fires once for that landing", () => {
    // First check: map not loaded yet (count 0). Second: map arrives.
    let remindedForId: number | null = null;
    const first = decidePostOvenReminder({ selectedItemId: GARLIC, postOvenCount: 0, remindedForId });
    remindedForId = first.remindedForId;
    const second = decidePostOvenReminder({ selectedItemId: GARLIC, postOvenCount: 1, remindedForId });
    remindedForId = second.remindedForId;
    const third = decidePostOvenReminder({ selectedItemId: GARLIC, postOvenCount: 1, remindedForId });
    expect([first.show, second.show, third.show]).toEqual([false, true, false]);
  });

  it("a fresh station visit (no memory) shows it on landing", () => {
    // Returning to the station remounts it with remindedForId back at null.
    expect(replay([GARLIC])).toEqual([true]);
  });
});
