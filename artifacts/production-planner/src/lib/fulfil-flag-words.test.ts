import { describe, expect, it } from "vitest";
import { agoWords, labelEnding, ordersAgoWords, shouldHaveGoneWords, whenWords } from "./fulfil-flag-words";

const now = new Date("2026-11-27T10:45:00Z"); // 10:45 London (GMT)

describe("fulfil flag words", () => {
  it("says when, today as a clock time and another day with the day", () => {
    expect(whenWords("2026-11-27T10:19:45Z", now)).toBe("10:19");
    expect(whenWords("2026-11-26T15:02:00Z", now)).toBe("Thu 26 Nov 15:02");
  });
  it("says how long ago", () => {
    expect(agoWords("2026-11-27T10:44:40Z", now)).toBe("just now");
    expect(agoWords("2026-11-27T10:19:45Z", now)).toBe("25 minutes ago");
    expect(agoWords("2026-11-27T09:40:00Z", now)).toBe("1 h 5 min ago");
    expect(agoWords("2026-11-25T10:00:00Z", now)).toBe("2 days ago");
  });
  it("says how many orders back", () => {
    expect(ordersAgoWords(null)).toBeNull();
    expect(ordersAgoWords(0)).toMatch(/last box/);
    expect(ordersAgoWords(1)).toBe("1 order ago");
    expect(ordersAgoWords(3)).toBe("about 3 orders ago");
  });
  it("puts it together (#140447)", () => {
    expect(shouldHaveGoneWords("2026-11-27T10:19:45Z", 3, now)).toBe("10:19 (25 minutes ago, about 3 orders ago)");
    expect(shouldHaveGoneWords("2026-11-27T10:19:45Z", null, now)).toBe("10:19 (25 minutes ago)");
    expect(labelEnding("2026112703036990023665")).toBe("023665");
    expect(labelEnding(null)).toBeNull();
  });
});
