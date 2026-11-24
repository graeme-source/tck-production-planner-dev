import { describe, expect, it } from "vitest";
import { timelineState } from "./reviews";

const part = (visibility: string, authorId: number | null, sharedAt: string | null = null) => ({ visibility, authorId, sharedAt });

describe("timelineState — is a meeting on their timeline?", () => {
  it("nothing written and no report: not shown, nothing to publish", () => {
    const s = timelineState([], [], 2);
    expect(s).toMatchObject({ shown: false, empty: true, toPublish: { parts: 0, reports: 0 } });
  });

  it("my private write-up: not shown, publishing would share my parts", () => {
    const s = timelineState([part("private", 2), part("private", 2)], [], 2);
    expect(s.shown).toBe(false);
    expect(s.toPublish).toEqual({ parts: 2, reports: 0 });
  });

  it("someone else's private part is never mine to publish", () => {
    expect(timelineState([part("private", 9)], [], 2).toPublish.parts).toBe(0);
  });

  it("a shared part puts it on their timeline, from the earliest share", () => {
    const s = timelineState([part("shared", 2, "2026-11-24T10:00:00Z"), part("shared", 2, "2026-11-20T10:00:00Z")], [], 2);
    expect(s).toMatchObject({ shown: true, since: "2026-11-20T10:00:00Z", toWithdraw: { parts: 2, reports: 0 }, othersShared: 0 });
  });

  it("a shared report alone puts it on their timeline", () => {
    const s = timelineState([], [{ sharedAt: "2026-11-24T10:00:00Z" }, { sharedAt: null }], 2);
    expect(s).toMatchObject({ shown: true, toPublish: { parts: 0, reports: 1 }, toWithdraw: { parts: 0, reports: 1 } });
  });

  it("someone else's shared part stays up after I withdraw mine", () => {
    const s = timelineState([part("shared", 9, "2026-11-24T10:00:00Z"), part("shared", 2, "2026-11-24T10:00:00Z")], [], 2);
    expect(s.othersShared).toBe(1);
    expect(s.toWithdraw.parts).toBe(1);
  });
});
