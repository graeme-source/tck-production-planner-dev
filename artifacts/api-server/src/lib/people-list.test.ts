import { describe, it, expect } from "vitest";
import { outstandingFormsForViewer, sortPeopleForList, personNeedsAction, type OutstandingSpell } from "./people-list";

const spell = (start: string, types = ["Sick Leave"]): OutstandingSpell => ({
  start, end: start, days: 1, types, sickness: types.some(t => t.includes("Sick")),
});

// Graeme's own ids aren't special here; any People-access viewer.
const due = new Map<number, OutstandingSpell[]>([
  [4, [spell("2026-08-24")]],                        // Ji-Hey Kim
  [17, [spell("2026-08-03")]],                       // Kyra Lucy Carroll
  [12, [spell("2026-09-14", ["Dependants Leave"])]], // Nozomi Tanaka
]);
const names = new Map([[4, "Ji-Hey Kim"], [17, "Kyra Lucy Carroll"], [12, "Nozomi Tanaka"], [1, "Graeme Carter"]]);

describe("outstandingFormsForViewer", () => {
  // Regression, 2026-09-25: Graeme opened Return to Work and saw "nothing in
  // there" — the page only listed the viewer's own absences, so the forms
  // other people owed never showed to the people meant to chase them.
  it("a People-access viewer sees OTHER people's outstanding forms", () => {
    const list = outstandingFormsForViewer({ id: 1, hasPeopleAccess: true }, due, names);
    expect(list.map(f => f.userName)).toEqual(["Nozomi Tanaka", "Ji-Hey Kim", "Kyra Lucy Carroll"]);
  });

  it("anyone else sees only their own", () => {
    expect(outstandingFormsForViewer({ id: 4, hasPeopleAccess: false }, due, names).map(f => f.userId)).toEqual([4]);
    expect(outstandingFormsForViewer({ id: 1, hasPeopleAccess: false }, due, names)).toEqual([]);
  });

  it("carries the absence type through", () => {
    const list = outstandingFormsForViewer({ id: 1, hasPeopleAccess: true }, due, names);
    expect(list[0].types).toEqual(["Dependants Leave"]);
  });
});

describe("sortPeopleForList", () => {
  const base = { isActive: true, formsNeeded: 0, triggers: { sickness: false, lates: false } };
  it("people needing action first, then by name, leavers last", () => {
    const sorted = sortPeopleForList([
      { ...base, id: 1, name: "Anna" },
      { ...base, id: 2, name: "Zoe", formsNeeded: 1 },
      { ...base, id: 3, name: "Bob", triggers: { sickness: false, lates: true } },
      { ...base, id: 4, name: "Aaron", isActive: false, formsNeeded: 3 },
      { ...base, id: 5, name: "Cara", formsNeeded: 2 },
    ]);
    expect(sorted.map(p => p.name)).toEqual(["Cara", "Zoe", "Bob", "Anna", "Aaron"]);
  });

  it("needs action = a form owed or a trigger hit", () => {
    expect(personNeedsAction({ ...base, id: 1, name: "x" })).toBe(false);
    expect(personNeedsAction({ ...base, id: 1, name: "x", triggers: { sickness: true, lates: false } })).toBe(true);
  });
});
