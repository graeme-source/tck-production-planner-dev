import { describe, it, expect } from "vitest";
import { isPinRequired, pinResetWindow } from "./pin-cutover";

const at = (iso: string) => new Date(iso);

describe("pinResetWindow", () => {
  it("morning in BST: latest is 04:00 UTC (05:00 London), next is 22:00 London (21:00 UTC)", () => {
    const w = pinResetWindow(at("2026-09-25T06:29:00Z"));
    expect(w.latest.toISOString()).toBe("2026-09-25T04:00:00.000Z");
    expect(w.next.toISOString()).toBe("2026-09-25T21:00:00.000Z");
  });

  it("late evening in BST: latest is 21:00 UTC, next is tomorrow 04:00 UTC", () => {
    const w = pinResetWindow(at("2026-09-24T23:00:00Z"));
    expect(w.latest.toISOString()).toBe("2026-09-24T21:00:00.000Z");
    expect(w.next.toISOString()).toBe("2026-09-25T04:00:00.000Z");
  });

  it("winter (GMT): the evening reset is 22:00 UTC", () => {
    const w = pinResetWindow(at("2026-12-11T01:00:00Z"));
    expect(w.latest.toISOString()).toBe("2026-12-10T22:00:00.000Z");
    expect(w.next.toISOString()).toBe("2026-12-11T04:00:00.000Z");
  });

  it("the clocks-go-back day uses GMT for that evening", () => {
    const w = pinResetWindow(at("2026-10-25T22:30:00Z"));
    expect(w.latest.toISOString()).toBe("2026-10-25T22:00:00.000Z");
  });

  it("the clocks-go-forward day uses BST for that evening", () => {
    const w = pinResetWindow(at("2026-03-29T21:30:00Z"));
    expect(w.latest.toISOString()).toBe("2026-03-29T21:00:00.000Z");
  });

  it("exactly at a reset counts as that reset having happened", () => {
    const w = pinResetWindow(at("2026-09-25T04:00:00Z"));
    expect(w.latest.toISOString()).toBe("2026-09-25T04:00:00.000Z");
    expect(w.next.toISOString()).toBe("2026-09-25T21:00:00.000Z");
  });
});

describe("isPinRequired", () => {
  // Fri 25 Sep 2026, plan 180: a session signed in as Grant (PIN last verified
  // 23:42 London the night before) recorded building batches from 07:50.
  it("a PIN verified last night is required again the next morning", () => {
    expect(isPinRequired("2026-09-24T22:42:00Z", at("2026-09-25T06:50:00Z"))).toBe(true);
  });

  it("a PIN verified after the morning reset is good until the evening reset", () => {
    expect(isPinRequired("2026-09-25T05:02:40Z", at("2026-09-25T06:50:00Z"))).toBe(false);
    expect(isPinRequired("2026-09-25T05:02:40Z", at("2026-09-25T20:59:59Z"))).toBe(false);
    expect(isPinRequired("2026-09-25T05:02:40Z", at("2026-09-25T21:00:01Z"))).toBe(true);
  });

  it("a PIN verified at 21:50 London is required after 22:00 London", () => {
    expect(isPinRequired("2026-09-24T20:50:00Z", at("2026-09-24T21:30:00Z"))).toBe(true);
  });

  it("never verified, or an unreadable timestamp, means PIN required", () => {
    expect(isPinRequired(undefined, at("2026-09-25T10:00:00Z"))).toBe(true);
    expect(isPinRequired(null, at("2026-09-25T10:00:00Z"))).toBe(true);
    expect(isPinRequired("not a date", at("2026-09-25T10:00:00Z"))).toBe(true);
  });
});
