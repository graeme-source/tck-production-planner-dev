import { describe, expect, it } from "vitest";
import { canRedo, canUndo, HISTORY_LIMIT, moveItem, record, redo, startHistory, undo } from "./undo-history";

describe("undo history", () => {
  it("undoes and redoes separate steps", () => {
    let h = startHistory(["a"]);
    h = record(h, ["a", "b"], 5000, true);
    h = record(h, ["a"], 5100, true); // deleted b
    expect(canUndo(h)).toBe(true);
    h = undo(h);
    expect(h.present).toEqual(["a", "b"]);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toEqual(["a"]);
  });

  it("joins quick typing into one step", () => {
    let h = startHistory("");
    h = record(h, "H", 1000);
    h = record(h, "Hi", 1300);
    h = record(h, "Hi!", 1600);
    expect(h.past).toEqual([""]);
    h = undo(h);
    expect(h.present).toBe("");
  });

  it("starts a new step after a pause", () => {
    let h = startHistory("");
    h = record(h, "Hi", 1000);
    h = record(h, "Hi there", 5000);
    expect(undo(h).present).toBe("Hi");
  });

  it("never joins a forced step to the typing before it", () => {
    let h = startHistory(["q1", "q2"]);
    h = record(h, ["q1 edited", "q2"], 1000);
    h = record(h, ["q1 edited"], 1200, true);
    expect(undo(h).present).toEqual(["q1 edited", "q2"]);
  });

  it("a new change clears redo", () => {
    let h = record(startHistory(1), 2, 1000, true);
    h = undo(h);
    h = record(h, 3, 2000);
    expect(canRedo(h)).toBe(false);
    expect(undo(h).present).toBe(1);
  });

  it("undo with nothing to undo is harmless, and history is capped", () => {
    expect(undo(startHistory(1)).present).toBe(1);
    let h = startHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h = record(h, i, i * 10_000, true);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
  });

  it("moves an item for drag and drop", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });
});
