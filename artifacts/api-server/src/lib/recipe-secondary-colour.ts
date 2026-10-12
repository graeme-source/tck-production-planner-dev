import { z } from "zod";

/**
 * Validation for a recipe's optional secondary colour (recipes.secondary_color,
 * migration 0185). Same shape as the primary colour picker sends: a 6-digit
 * hex like "#e11d48". Absent = leave as is (older clients, the recipe
 * designer, duplicate never wipe it); null or "" = "None", clears it.
 */
const SecondaryColourSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Secondary colour must be a hex colour like #e11d48")
  .nullable();

export type SecondaryColourFields = { secondaryColor?: string | null };

export function parseSecondaryColour(body: unknown): { ok: true; fields: SecondaryColourFields } | { ok: false; error: string } {
  const src = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (!("secondaryColor" in src) || src.secondaryColor === undefined) return { ok: true, fields: {} };
  const raw = src.secondaryColor;
  const value = raw === "" ? null : raw;
  const result = SecondaryColourSchema.safeParse(value);
  if (!result.success) return { ok: false, error: result.error.issues[0]?.message ?? "Invalid secondary colour" };
  return { ok: true, fields: { secondaryColor: result.data ? result.data.toLowerCase() : null } };
}
