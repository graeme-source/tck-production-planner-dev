import { describe, expect, it } from "vitest";
import {
  canExpandDayList, dayListCaption, dayListToggleLabel, readDayListExpanded, visibleDayRows, writeDayListExpanded,
} from "./kpi-day-list";

const days = Array.from({ length: 30 }, (_, i) => `d${i + 1}`); // oldest first

describe("visibleDayRows", () => {
  it("collapsed shows the newest 7, newest first", () => {
    expect(visibleDayRows(days, false)).toEqual(["d30", "d29", "d28", "d27", "d26", "d25", "d24"]);
  });
  it("expanded shows all 30, newest first", () => {
    const rows = visibleDayRows(days, true);
    expect(rows).toHaveLength(30);
    expect(rows[0]).toBe("d30");
    expect(rows[29]).toBe("d1");
  });
  it("does not mutate the input", () => {
    const copy = [...days];
    visibleDayRows(days, true);
    expect(days).toEqual(copy);
  });
  it("copes with fewer days than the collapsed size", () => {
    expect(visibleDayRows(["a", "b"], false)).toEqual(["b", "a"]);
  });
});

describe("labels", () => {
  it("toggle label", () => {
    expect(dayListToggleLabel(false, 30)).toBe("Show all 30 days");
    expect(dayListToggleLabel(true, 30)).toBe("Show last 7 days");
  });
  it("caption says how much is shown", () => {
    expect(dayListCaption("30-day average as it stood each day", false, 30)).toBe("30-day average as it stood each day — last 7 shown");
    expect(dayListCaption("30-day average as it stood each day", true, 30)).toBe("30-day average as it stood each day — all 30 days shown");
  });
  it("no expand when 7 or fewer days", () => {
    expect(canExpandDayList(7)).toBe(false);
    expect(canExpandDayList(30)).toBe(true);
    expect(dayListCaption("Avg", false, 5)).toBe("Avg");
  });
});

describe("remembered state", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it("defaults collapsed and remembers per card", () => {
    const s = mem();
    expect(readDayListExpanded("nc30", s)).toBe(false);
    writeDayListExpanded("nc30", true, s);
    expect(readDayListExpanded("nc30", s)).toBe(true);
    expect(readDayListExpanded("total30", s)).toBe(false);
  });
  it("never throws when storage is blocked", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readDayListExpanded("nc30", broken)).toBe(false);
    expect(() => writeDayListExpanded("nc30", true, broken)).not.toThrow();
    expect(readDayListExpanded("nc30", null)).toBe(false);
  });
});
