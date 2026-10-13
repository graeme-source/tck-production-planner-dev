import { describe, expect, it } from "vitest";
import {
  agreementBullets, agreementBody, appendAgreementBullets, latestAgreements, ownRecordView, NOTE_KINDS, NOTE_KIND_LABEL,
} from "./index";

describe("what was agreed — one bulleted list", () => {
  it("is its own kind of write-up part", () => {
    expect(NOTE_KINDS).toContain("agreement");
    expect(NOTE_KIND_LABEL.agreement).toBe("What was agreed");
  });
  it("bullets in, bullets out", () => {
    expect(agreementBody(["Back on 4 May 2027", "  ", " Two  KIT days "])).toBe("• Back on 4 May 2027\n• Two KIT days");
    expect(agreementBody([])).toBe("");
    expect(agreementBullets("• Back on 4 May\n\n- Two KIT days\n* Phased return\n1. First\nTyped plainly")).toEqual([
      "Back on 4 May", "Two KIT days", "Phased return", "First", "Typed plainly",
    ]);
  });
  it("never eats a number or a minus that starts a point", () => {
    expect(agreementBullets("2.5 days a week\n-3°C freezer cover\n24 hours a week")).toEqual([
      "2.5 days a week", "-3°C freezer cover", "24 hours a week",
    ]);
  });
  it("adding to a list keeps one list, without repeats", () => {
    expect(appendAgreementBullets("• Back on 4 May", ["back on 4 may", "Two KIT days", ""])).toBe("• Back on 4 May\n• Two KIT days");
    expect(appendAgreementBullets(null, ["One"])).toBe("• One");
  });
});

describe("the What we agreed panel reads the latest review's list", () => {
  const n = (id: number, entryId: number | null, kind: string, createdAt = "2026-10-01T09:00:00Z") => ({ id, entryId, kind, createdAt, body: "• x" });
  const reviews = [{ id: 1, day: "2026-09-01" }, { id: 2, day: "2026-10-12" }, { id: 3, day: "2026-10-01" }];

  it("the list from the most recent review that has one", () => {
    const got = latestAgreements([n(10, 1, "agreement"), n(11, 3, "agreement"), n(12, 2, "objective")], reviews);
    expect(got.map(x => x.id)).toEqual([11]);
  });
  it("nothing when no review has one; loose or unknown reviews never count", () => {
    expect(latestAgreements([n(1, 1, "objective")], reviews)).toEqual([]);
    expect(latestAgreements([n(1, null, "agreement"), n(2, 99, "agreement")], reviews)).toEqual([]);
  });
  it("same day: the later review wins; two lists on it come oldest first", () => {
    const same = [{ id: 4, day: "2026-10-12" }, { id: 5, day: "2026-10-12" }];
    const got = latestAgreements([n(1, 4, "agreement"), n(3, 5, "agreement", "2026-10-12T11:00:00Z"), n(2, 5, "agreement", "2026-10-12T10:00:00Z")], same);
    expect(got.map(x => x.id)).toEqual([2, 3]);
  });
  it("the employee's view: shared agreement apart from objectives", () => {
    const rs = [
      { id: 1, entryDate: "2026-09-01", meetingDate: null, meetingStatus: "held" as const, heldAt: null },
      { id: 2, entryDate: "2026-10-12", meetingDate: null, meetingStatus: "held" as const, heldAt: null },
    ];
    const note = (id: number, entryId: number, kind: string) => ({ id, entryId, kind, doneAt: null, createdAt: "2026-10-12T09:00:00Z" });
    const v = ownRecordView(rs, [note(1, 1, "objective"), note(2, 2, "agreement"), note(3, 1, "agreement")]);
    expect(v.agreement.map(x => x.id)).toEqual([2]);
    expect(v.agreed.map(x => x.id)).toEqual([1]);
  });
});
