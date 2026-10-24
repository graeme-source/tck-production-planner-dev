import { describe, it, expect } from "vitest";
import { parseSmartAdd } from "@workspace/recurrence";
import { checklistScheduleFor, placeTask, type Choices } from "./smart-add-plan";

const TODAY = "2026-10-24";
const CHOICES: Choices = {
  people: [{ id: 2, name: "Graeme Carter" }, { id: 7, name: "Jane Miles" }],
  teamLists: [{ id: 5, name: "Office" }],
  stations: [{ stationType: "packing", label: "Packing" }],
};
const TODO_ME = { kind: "todo" as const, assigneeId: 2 };
const EVERYONE = CHOICES.people;
const place = (text: string, ai: Parameters<typeof placeTask>[0]["ai"] = null, choices = CHOICES) =>
  placeTask({ parse: parseSmartAdd(text, TODAY, EVERYONE), ai, context: TODO_ME, choices, callerId: 2, today: TODAY, text });

describe("smart add placement", () => {
  it("@Jane Miles goes on Jane's to-do list whatever the AI says", () => {
    const p = place("check fridge seals @Jane Miles p1", { destination: { kind: "team_list", listId: 5 } });
    expect(p.destination).toEqual({ kind: "todo", assigneeId: 7 });
    expect(p.destinationLabel).toBe("Jane Miles’s to-do list");
    expect(p.priority).toBe(1);
  });
  it("a non-manager can't @ someone else", () => {
    const p = place("@Jane Miles check seals", null, { ...CHOICES, people: [{ id: 2, name: "Graeme Carter" }] });
    expect(p.problem).toMatch(/Only managers/);
  });
  it("the AI picks the checklist; the typed repeat wins", () => {
    const p = place("clean packing computer every thursday packing cleaning check", {
      destination: { kind: "checklist", stationType: "packing", category: "cleaning" },
      title: "Clean packing computer", repeat: "every friday",
    });
    expect(p.destination).toEqual({ kind: "checklist", stationType: "packing", category: "cleaning" });
    expect(p.destinationLabel).toBe("the Packing cleaning check");
    expect(p.rule).toMatchObject({ kind: "weekly", days: [4] });
    expect(p.title).toBe("Clean packing computer");
    expect(p.problem).toBeNull();
  });
  it("an @name nobody has is flagged", () => {
    expect(place("@Bob check seals").problem).toMatch(/don’t know who @Bob/);
  });
  it("a destination the caller can't use falls back to where the box is", () => {
    const p = place("order gloves", { destination: { kind: "team_list", listId: 999 } });
    expect(p.destination).toEqual(TODO_ME);
  });
  it("the AI fills a repeat the rules missed", () => {
    const p = place("water the plants every other thursday", { repeat: "fortnightly on thursday" });
    expect(p.rule).toMatchObject({ kind: "weekly", interval: 2 });
  });
  it("a checklist from outside a station needs the station named", () => {
    const ai = { destination: { kind: "checklist" as const, stationType: "packing", category: "closing" as const } };
    expect(place("closing check: wipe the scales every friday", ai).problem).toMatch(/Which station/);
    expect(placeTask({ parse: parseSmartAdd("wipe the scales every friday packing closing check", TODAY, EVERYONE), ai, context: TODO_ME, choices: CHOICES, callerId: 2, today: TODAY, text: "wipe the scales every friday packing closing check" }).problem).toBeNull();
  });
  it("a checklist needs a repeat it can hold", () => {
    expect(place("defrost packing freezer tomorrow", { destination: { kind: "checklist", stationType: "packing", category: "closing" } }).problem).toMatch(/repeat/);
    expect(place("deep clean packing every 3 months", { destination: { kind: "checklist", stationType: "packing", category: "cleaning" } }).problem).toMatch(/set weekdays/);
  });
});

describe("checklistScheduleFor", () => {
  it("maps daily, weekdays and set days; refuses the rest", () => {
    expect(checklistScheduleFor(null)).toEqual({ schedule: "daily" });
    expect(checklistScheduleFor({ kind: "weekly", days: [4] })).toEqual({ schedule: "specific_days", scheduleDays: ["thursday"] });
    expect(checklistScheduleFor({ kind: "weekly", days: [4], interval: 2 })).toBeNull();
    expect(checklistScheduleFor({ kind: "monthly", dayOfMonth: 1 })).toBeNull();
  });
});
