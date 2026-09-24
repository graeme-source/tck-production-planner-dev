import { z } from "zod";

/**
 * Validation for a recipe's oven override (recipes.oven_temp_c /
 * oven_time_seconds, migration 0118). Both fields are optional on create and
 * update: absent = leave as is, null = clear back to the dietary profile's
 * standard. Bounds are sanity limits for a pizza/calzone oven, not recipe
 * rules — they only catch typos like 2000°C or 6 seconds.
 */
const OvenOverrideSchema = z.object({
  ovenTempC: z.number().int().min(50, "Oven temperature must be at least 50°C").max(450, "Oven temperature must be at most 450°C").nullable().optional(),
  ovenTimeSeconds: z.number().int().min(30, "Oven time must be at least 0:30").max(3600, "Oven time must be at most 60:00").nullable().optional(),
});

export type OvenOverrideFields = { ovenTempC?: number | null; ovenTimeSeconds?: number | null };

/** Parse the oven override keys out of a recipe body. Only keys present in
 *  the body appear in `fields`, so a caller that never sends them (the
 *  recipe designer, duplicate, older clients) can't wipe a saved override. */
export function parseOvenOverride(body: unknown): { ok: true; fields: OvenOverrideFields } | { ok: false; error: string } {
  const src = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of ["ovenTempC", "ovenTimeSeconds"] as const) {
    if (!(key in src)) continue;
    const v = src[key];
    // Forms send "" for a cleared number input.
    picked[key] = v === "" || v === undefined ? null : typeof v === "string" ? Number(v) : v;
  }
  const result = OvenOverrideSchema.safeParse(picked);
  if (!result.success) {
    return { ok: false, error: result.error.issues[0]?.message ?? "Invalid oven override" };
  }
  const fields: OvenOverrideFields = {};
  if ("ovenTempC" in picked) fields.ovenTempC = result.data.ovenTempC ?? null;
  if ("ovenTimeSeconds" in picked) fields.ovenTimeSeconds = result.data.ovenTimeSeconds ?? null;
  return { ok: true, fields };
}
