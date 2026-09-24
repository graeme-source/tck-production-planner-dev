import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListRecipes, getListRecipesQueryKey } from "@workspace/api-client-react";
import type { OvenStandards, RecipeOvenInput } from "@/pages/station/shared/oven-reminder";

/**
 * Oven settings for the stations: the meat / vegetarian standards from
 * app_settings (edited in Settings → oven defaults) and each recipe's own
 * override from the recipe list (recipes.oven_temp_c / oven_time_seconds,
 * edited on the recipe form). Feed both to shared/oven-reminder.ts.
 *
 * `standards` is null until the settings have loaded, so callers can hold
 * back the first-batch prompt rather than flash the fallback numbers.
 */
const FALLBACK: OvenStandards = { meatTempC: 220, meatTimeMin: 8, vegTempC: 210, vegTimeMin: 7 };
const KEYS = ["oven_meat_temp_c", "oven_meat_time_min", "oven_veg_temp_c", "oven_veg_time_min"] as const;

async function readSetting(key: string): Promise<string | null> {
  // Any failure falls back to the standard defaults (same posture as the
  // building station's original fetch): an oven reminder with the usual
  // numbers beats no reminder at all.
  try {
    const r = await fetch(`/api/app-settings/${key}`, { credentials: "include" });
    if (!r.ok) return null; // 404 = never saved → fallback
    const d = await r.json() as { value?: string | null };
    return d?.value ?? null;
  } catch (err) {
    console.warn(`[oven-settings] ${key} fetch failed — using default:`, err);
    return null;
  }
}

const num = (v: string | null, fallback: number) => {
  const n = Number(v);
  return v != null && Number.isFinite(n) && n > 0 ? n : fallback;
};

export function useOvenStandards(): OvenStandards | null {
  const { data } = useQuery({
    queryKey: ["oven-standards"],
    queryFn: async (): Promise<OvenStandards> => {
      const [mt, mm, vt, vm] = await Promise.all(KEYS.map(readSetting));
      return {
        meatTempC: num(mt, FALLBACK.meatTempC),
        meatTimeMin: num(mm, FALLBACK.meatTimeMin),
        vegTempC: num(vt, FALLBACK.vegTempC),
        vegTimeMin: num(vm, FALLBACK.vegTimeMin),
      };
    },
    staleTime: 5 * 60_000,
  });
  return data ?? null;
}

/** recipeId → oven inputs (profile + override). The generated Recipe type
 *  predates the override columns, so they're read loosely. */
export function useRecipeOvenInputs(): Map<number, RecipeOvenInput> {
  const { data } = useListRecipes({ query: { queryKey: getListRecipesQueryKey(), staleTime: 5 * 60_000 } });
  return useMemo(() => {
    const map = new Map<number, RecipeOvenInput>();
    for (const r of (data ?? []) as Array<{ id: number; dietaryCategory?: string | null; ovenTempC?: number | null; ovenTimeSeconds?: number | null }>) {
      map.set(r.id, {
        dietaryCategory: r.dietaryCategory ?? null,
        ovenTempC: r.ovenTempC ?? null,
        ovenTimeSeconds: r.ovenTimeSeconds ?? null,
      });
    }
    return map;
  }, [data]);
}
