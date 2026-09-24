/**
 * Oven settings per recipe — the standard for the recipe's dietary profile
 * (app_settings oven_meat_* / oven_veg_*, edited in Settings) unless the
 * recipe carries its own override (recipes.oven_temp_c / oven_time_seconds,
 * set on the recipe form). Kitchen request 2026-09-15: some recipes
 * over-cook at the standard and need e.g. 200°C for 6:00, so the builders
 * need an unmissable "oven change" reminder. Pure logic, no names: which
 * recipes differ is data.
 */

export interface OvenStandards {
  meatTempC: number;
  meatTimeMin: number;
  vegTempC: number;
  vegTimeMin: number;
}

export interface RecipeOvenInput {
  dietaryCategory?: string | null;
  ovenTempC?: number | null;
  ovenTimeSeconds?: number | null;
}

export interface OvenSetting {
  tempC: number;
  timeSeconds: number;
}

/** The profile standard for a recipe, or null when it has no profile. */
export function standardOvenSetting(recipe: RecipeOvenInput, standards: OvenStandards): OvenSetting | null {
  if (recipe.dietaryCategory === "meat") return { tempC: standards.meatTempC, timeSeconds: Math.round(standards.meatTimeMin * 60) };
  if (recipe.dietaryCategory === "vegetarian") return { tempC: standards.vegTempC, timeSeconds: Math.round(standards.vegTimeMin * 60) };
  return null;
}

const positive = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** What the oven should be set to for this recipe. Each half of the
 *  override falls back to the profile standard on its own (a recipe can
 *  override just the time). Null when there's no profile and no complete
 *  override — nothing to tell the builders. */
export function effectiveOvenSetting(recipe: RecipeOvenInput, standards: OvenStandards): OvenSetting | null {
  const std = standardOvenSetting(recipe, standards);
  const tempC = positive(recipe.ovenTempC) ? recipe.ovenTempC : std?.tempC;
  const timeSeconds = positive(recipe.ovenTimeSeconds) ? recipe.ovenTimeSeconds : std?.timeSeconds;
  if (tempC == null || timeSeconds == null) return null;
  return { tempC, timeSeconds };
}

export interface OvenChangeReminder {
  setting: OvenSetting;
  /** The profile standard it differs from; null when the recipe has no profile. */
  standard: OvenSetting | null;
}

/** A reminder when this recipe's oven setting differs from its profile's
 *  standard; null when it bakes at the standard. */
export function ovenChangeReminder(recipe: RecipeOvenInput, standards: OvenStandards): OvenChangeReminder | null {
  if (!positive(recipe.ovenTempC) && !positive(recipe.ovenTimeSeconds)) return null;
  const setting = effectiveOvenSetting(recipe, standards);
  if (!setting) return null;
  const standard = standardOvenSetting(recipe, standards);
  if (standard && standard.tempC === setting.tempC && standard.timeSeconds === setting.timeSeconds) return null;
  return { setting, standard };
}

/** Stable key for "the oven is set to this" — the first-batch oven prompt
 *  re-appears whenever the next recipe needs a different key. */
export function ovenSettingKey(s: OvenSetting | null): string | null {
  return s ? `${s.tempC}|${s.timeSeconds}` : null;
}

/** 360 → "6:00", 390 → "6:30". */
export function formatOvenTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
