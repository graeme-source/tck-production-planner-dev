import { describe, it, expect } from "vitest";
import {
  absenceRuns, absenceSpells, dueSpells, spellFormState, absenceTypeLabel, absencePhrase,
  addDaysIso, DUE_WINDOW_DAYS, type ClassifiedShift,
} from "./absence-spells";

const sh = (date: string, typeName: string | null = null): ClassifiedShift => ({ date, typeName });
const TODAY = "2026-09-25";

describe("absenceRuns", () => {
  it("a run of sick days is one spell until a worked shift breaks it", () => {
    const runs = absenceRuns([
      sh("2026-09-07", "Sick Leave"), sh("2026-09-08", "Sick Leave"),
      sh("2026-09-09"),
      sh("2026-09-10", "Sick Leave"),
    ]);
    expect(runs.map(r => [r.start, r.end, r.days])).toEqual([
      ["2026-09-07", "2026-09-08", 2],
      ["2026-09-10", "2026-09-10", 1],
    ]);
  });

  it("dependants' leave makes a spell of its own (not sickness)", () => {
    const [run] = absenceRuns([sh("2026-09-14", "Dependants Leave"), sh("2026-09-15")]);
    expect(run).toMatchObject({ start: "2026-09-14", end: "2026-09-14", days: 1, types: ["Dependants Leave"], sickness: false });
  });

  it("mixed types with no worked shift between are ONE absence", () => {
    const [run, ...rest] = absenceRuns([sh("2026-09-14", "Sick Leave"), sh("2026-09-15", "Absent")]);
    expect(rest).toEqual([]);
    expect(run).toMatchObject({ days: 2, types: ["Sick Leave", "Absent"], sickness: true });
  });

  it("holiday, lates, meetings and training never start a spell", () => {
    expect(absenceRuns([
      sh("2026-09-01", "Holiday (with Pay)"), sh("2026-09-02", "Arrived late"),
      sh("2026-09-03", "Meeting"), sh("2026-09-04", "Training"),
    ])).toEqual([]);
  });

  it("a late between two absences breaks them (they came in)", () => {
    expect(absenceRuns([
      sh("2026-09-01", "Absent"), sh("2026-09-02", "Arrived late"), sh("2026-09-03", "Absent"),
    ])).toHaveLength(2);
  });
});

describe("absenceSpells + form state", () => {
  it("back with no form, recently → form needed (the Nozomi case)", () => {
    const spells = absenceSpells([sh("2026-09-14", "Dependants Leave"), sh("2026-09-15")], [], TODAY);
    expect(spells[0]).toMatchObject({ returned: true, formId: null, formState: "needed" });
    expect(dueSpells(spells)).toHaveLength(1);
  });

  it("a form overlapping the dates covers the spell", () => {
    const spells = absenceSpells(
      [sh("2026-09-14", "Sick Leave"), sh("2026-09-15")],
      [{ id: 9, absenceStart: "2026-09-14", absenceEnd: "2026-09-14", status: "complete" }],
      TODAY,
    );
    expect(spells[0]).toMatchObject({ formId: 9, formState: "signed" });
    expect(dueSpells(spells)).toEqual([]);
  });

  it("a draft form shows as draft and isn't outstanding", () => {
    const spells = absenceSpells(
      [sh("2026-08-24", "Sick Leave"), sh("2026-08-25")],
      [{ id: 3, absenceStart: "2026-08-24", absenceEnd: null, status: "draft" }],
      TODAY,
    );
    expect(spells[0].formState).toBe("draft");
    expect(dueSpells(spells)).toEqual([]);
  });

  it("still off → away, not yet due", () => {
    const spells = absenceSpells([sh("2026-09-23", "Sick Leave"), sh("2026-09-24", "Sick Leave")], [], TODAY);
    expect(spells[0].formState).toBe("away");
    expect(dueSpells(spells)).toEqual([]);
  });

  it("older than the chase window → missing, shown but not outstanding", () => {
    const old = addDaysIso(TODAY, -(DUE_WINDOW_DAYS + 5));
    const spells = absenceSpells([sh(old, "Sick Leave"), sh(addDaysIso(old, 1))], [], TODAY);
    expect(spells[0].formState).toBe("missing");
    expect(dueSpells(spells)).toEqual([]);
  });

  it("the window edge is inclusive", () => {
    const edge = addDaysIso(TODAY, -DUE_WINDOW_DAYS);
    expect(spellFormState({ end: edge, returned: true, formId: null, formStatus: null }, TODAY)).toBe("needed");
  });
});

describe("wording", () => {
  it("labels types verbatim", () => {
    expect(absenceTypeLabel(["Sick Leave", "Absent"])).toBe("Sick Leave + Absent");
    expect(absenceTypeLabel([])).toBe("Absence");
  });
  it("says off sick only when it was all sickness", () => {
    expect(absencePhrase({ sickness: true, types: ["Sick Leave"] })).toBe("off sick");
    expect(absencePhrase({ sickness: false, types: ["Dependants Leave"] })).toBe("absent — Dependants Leave");
    expect(absencePhrase({ sickness: true, types: ["Sick Leave", "Absent"] })).toBe("absent — Sick Leave + Absent");
  });
});
