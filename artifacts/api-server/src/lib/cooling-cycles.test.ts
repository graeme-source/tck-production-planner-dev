import { describe, it, expect } from "vitest";
import {
  coolingMinutes, calzoneCoolingCycle, subRecipeCoolingCycle, coolingLog,
  cookChillStage, canStartChill, canFinishChill, onCookChillBoard,
} from "./cooling-cycles";

describe("coolingMinutes", () => {
  it("whole minutes from in to finished", () => {
    expect(coolingMinutes("2026-10-22T10:00:00Z", "2026-10-22T11:29:40Z")).toBe(90);
  });
  it("null while still chilling or when the end isn't after the start", () => {
    expect(coolingMinutes("2026-10-22T10:00:00Z", null)).toBeNull();
    expect(coolingMinutes("2026-10-22T10:00:00Z", "2026-10-22T10:00:00Z")).toBeNull();
    expect(coolingMinutes("2026-10-22T10:00:00Z", "2026-10-22T09:00:00Z")).toBeNull();
    expect(coolingMinutes("nonsense", "2026-10-22T09:00:00Z")).toBeNull();
  });
});

describe("one cooling shape for calzones and sub-recipes", () => {
  const calzone = calzoneCoolingCycle({
    id: 7, recipeName: "Pepperoni", recordedAt: new Date("2026-10-22T12:00:00Z"),
    chillEndAt: new Date("2026-10-22T13:00:00Z"), chilledVia: "wrapping_station",
    weighedByName: "Tommy", chilledByName: "Jane",
  });
  const sub = subRecipeCoolingCycle({
    id: 3, subRecipeName: "Garlic Confit", chillStartAt: "2026-10-22T14:00:00Z",
    chillEndAt: null, chilledVia: null, chillStartByName: "Jane", chillEndByName: null,
  });
  it("maps both to the same fields", () => {
    expect(calzone).toMatchObject({ source: "calzone", name: "Pepperoni", durationMinutes: 60, startedByName: "Tommy", finishedByName: "Jane" });
    expect(sub).toMatchObject({ source: "sub_recipe", name: "Garlic Confit", endAt: null, durationMinutes: null });
  });
  it("a sub-recipe not yet in the chiller has no cycle", () => {
    expect(subRecipeCoolingCycle({
      id: 4, subRecipeName: "Garlic Butter", chillStartAt: null, chillEndAt: null,
      chilledVia: null, chillStartByName: null, chillEndByName: null,
    })).toBeNull();
  });
  it("the log is newest first and drops the empties", () => {
    expect(coolingLog([calzone, null, sub]).map(c => c.name)).toEqual(["Garlic Confit", "Pepperoni"]);
  });
});

describe("cook-and-chill steps", () => {
  const cooked = { chillStartAt: null, chillEndAt: null };
  const chilling = { chillStartAt: "2026-10-22T10:00:00Z", chillEndAt: null };
  const chilled = { chillStartAt: "2026-10-22T10:00:00Z", chillEndAt: "2026-10-22T11:00:00Z" };
  it("stage follows the stamps", () => {
    expect(cookChillStage(cooked)).toBe("cooked");
    expect(cookChillStage(chilling)).toBe("chilling");
    expect(cookChillStage(chilled)).toBe("chilled");
  });
  it("into the chiller once", () => {
    expect(canStartChill(cooked)).toEqual({ ok: true });
    expect(canStartChill(chilling)).toMatchObject({ ok: false, already: true });
  });
  it("finished only after it went in, and only once", () => {
    expect(canFinishChill(cooked)).toMatchObject({ ok: false, already: false });
    expect(canFinishChill(chilling)).toEqual({ ok: true });
    expect(canFinishChill(chilled)).toMatchObject({ ok: false, already: true });
  });
});

describe("onCookChillBoard", () => {
  const now = new Date("2026-10-22T15:00:00Z");
  const todayStart = new Date("2026-10-21T23:00:00Z");
  it("keeps unfinished records from the last 3 days (prep works a day ahead)", () => {
    expect(onCookChillBoard({ cookedAt: "2026-10-21T09:00:00Z", chillEndAt: null }, now, todayStart)).toBe(true);
    expect(onCookChillBoard({ cookedAt: "2026-10-18T09:00:00Z", chillEndAt: null }, now, todayStart)).toBe(false);
  });
  it("finished ones stay for the rest of today only", () => {
    expect(onCookChillBoard({ cookedAt: "2026-10-22T08:00:00Z", chillEndAt: "2026-10-22T10:00:00Z" }, now, todayStart)).toBe(true);
    expect(onCookChillBoard({ cookedAt: "2026-10-21T08:00:00Z", chillEndAt: "2026-10-21T12:00:00Z" }, now, todayStart)).toBe(false);
  });
});
