import { describe, it, expect } from "vitest";
import { absencePhrase, isSicknessType, absenceTypeChoices } from "./rtw-wording";

describe("absencePhrase", () => {
  it("says off sick for sickness and for older untyped forms", () => {
    expect(absencePhrase("Sick Leave")).toBe("off sick");
    expect(absencePhrase("Sick - unpaid")).toBe("off sick");
    expect(absencePhrase("Sickness")).toBe("off sick");
    expect(absencePhrase(null)).toBe("off sick");
  });

  it("names any other absence", () => {
    expect(absencePhrase("Dependants Leave")).toBe("absent — Dependants Leave");
    expect(absencePhrase("Sick Leave + Absent")).toBe("absent — Sick Leave + Absent");
    expect(isSicknessType("Emergency leave")).toBe(false);
  });
});

describe("absenceTypeChoices", () => {
  it("keeps a Planday name the list doesn't have, first", () => {
    expect(absenceTypeChoices("Dependants Leave")[0]).toBe("Dependants Leave");
    expect(absenceTypeChoices("Sickness")).not.toContain(undefined);
    expect(absenceTypeChoices(null)[0]).toBe("Sickness");
  });
});
