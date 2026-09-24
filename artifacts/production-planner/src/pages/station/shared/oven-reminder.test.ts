import { describe, it, expect } from "vitest";
import { effectiveOvenSetting, ovenChangeReminder, ovenSettingKey, formatOvenTime, type OvenStandards } from "./oven-reminder";

const standards: OvenStandards = { meatTempC: 220, meatTimeMin: 8, vegTempC: 210, vegTimeMin: 7 };

describe("ovenChangeReminder", () => {
  it("reminds for a meat recipe with its own 200°C / 6:00 setting", () => {
    expect(ovenChangeReminder({ dietaryCategory: "meat", ovenTempC: 200, ovenTimeSeconds: 360 }, standards)).toEqual({
      setting: { tempC: 200, timeSeconds: 360 },
      standard: { tempC: 220, timeSeconds: 480 },
    });
  });

  it("says nothing for a recipe baked at its profile standard", () => {
    expect(ovenChangeReminder({ dietaryCategory: "meat" }, standards)).toBeNull();
    expect(ovenChangeReminder({ dietaryCategory: "vegetarian", ovenTempC: null, ovenTimeSeconds: null }, standards)).toBeNull();
  });

  it("says nothing when the override matches the standard exactly", () => {
    expect(ovenChangeReminder({ dietaryCategory: "meat", ovenTempC: 220, ovenTimeSeconds: 480 }, standards)).toBeNull();
  });

  it("fills a half override from the standard", () => {
    expect(ovenChangeReminder({ dietaryCategory: "vegetarian", ovenTimeSeconds: 330 }, standards)?.setting).toEqual({ tempC: 210, timeSeconds: 330 });
  });

  it("reminds with no standard when the recipe has no profile but a full override", () => {
    expect(ovenChangeReminder({ dietaryCategory: null, ovenTempC: 200, ovenTimeSeconds: 360 }, standards)).toEqual({
      setting: { tempC: 200, timeSeconds: 360 },
      standard: null,
    });
    // Half an override and no profile: can't say what to set, so no reminder.
    expect(ovenChangeReminder({ dietaryCategory: null, ovenTempC: 200 }, standards)).toBeNull();
  });
});

describe("ovenSettingKey", () => {
  it("changes between a standard meat recipe and an overridden one, so the oven prompt re-appears", () => {
    const std = effectiveOvenSetting({ dietaryCategory: "meat" }, standards);
    const over = effectiveOvenSetting({ dietaryCategory: "meat", ovenTempC: 200, ovenTimeSeconds: 360 }, standards);
    expect(ovenSettingKey(std)).not.toBe(ovenSettingKey(over));
    expect(ovenSettingKey(std)).toBe(ovenSettingKey(effectiveOvenSetting({ dietaryCategory: "meat" }, standards)));
    expect(ovenSettingKey(null)).toBeNull();
  });
});

describe("formatOvenTime", () => {
  it("formats minutes:seconds", () => {
    expect(formatOvenTime(360)).toBe("6:00");
    expect(formatOvenTime(390)).toBe("6:30");
    expect(formatOvenTime(480)).toBe("8:00");
  });
});
