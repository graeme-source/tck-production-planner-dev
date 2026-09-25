import { describe, it, expect } from "vitest";
import { chooseContractedHours, type ContractHoursCandidates } from "./contracted-hours";

const none: ContractHoursCandidates = { issued: null, planday: { rule: null, status: "ok" }, uploaded: null };

describe("chooseContractedHours", () => {
  it("an issued in-app contract comes first", () => {
    const r = chooseContractedHours({
      issued: { weeklyHours: "41.25", issuedAt: "2026-09-07" },
      planday: { rule: "33 Hours per week", status: "ok" },
      uploaded: { confirmedHours: "37.5", extractedHours: null, issueDate: null },
    });
    expect(r).toMatchObject({ hours: 41.25, source: "issued_contract", sourceText: "41.25", sourceDate: "2026-09-07" });
  });

  it("then the Planday contract rule, read from its name", () => {
    expect(chooseContractedHours({ ...none, planday: { rule: "41.25 Hours", status: "ok" } }))
      .toMatchObject({ hours: 41.25, source: "planday_rule" });
    expect(chooseContractedHours({ ...none, planday: { rule: "16.5 Hours per week", status: "ok" } }))
      .toMatchObject({ hours: 16.5, source: "planday_rule" });
  });

  it("then an uploaded contract — the confirmed value over the one read off the document", () => {
    const r = chooseContractedHours({ ...none, uploaded: { confirmedHours: "40", extractedHours: "37.5", issueDate: "2023-03-01" } });
    expect(r).toMatchObject({ hours: 40, source: "uploaded_contract", sourceDate: "2023-03-01" });
    expect(chooseContractedHours({ ...none, uploaded: { confirmedHours: null, extractedHours: "37½ hours per week", issueDate: null } }))
      .toMatchObject({ hours: 37.5, source: "uploaded_contract" });
  });

  it("nothing on file", () => {
    expect(chooseContractedHours(none)).toEqual({ hours: null, source: null, sourceText: null, sourceDate: null, notes: [] });
  });

  it("an unusable source is skipped with a note and the next one used", () => {
    const r = chooseContractedHours({
      issued: { weeklyHours: "zero hours", issuedAt: null },
      planday: { rule: "22.25 Hours per week", status: "ok" },
      uploaded: null,
    });
    expect(r.source).toBe("planday_rule");
    expect(r.hours).toBe(22.25);
    expect(r.notes[0]).toMatch(/zero hours/);
  });

  it("says when Planday couldn't be asked", () => {
    const r = chooseContractedHours({ ...none, planday: { rule: null, status: "unreachable" } });
    expect(r.hours).toBeNull();
    expect(r.notes).toEqual(["Couldn't reach Planday to check for a contract rule."]);
  });

  it("a Planday rule is ignored unless Planday answered", () => {
    expect(chooseContractedHours({ ...none, planday: { rule: "40 Hours", status: "not_linked" } }).hours).toBeNull();
  });
});
