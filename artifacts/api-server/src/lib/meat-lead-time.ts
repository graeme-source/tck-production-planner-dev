/**
 * How long before building a raw meat must go in (Graeme, 2026-09-24):
 * estimated cook time + estimated process time, both from the ingredient.
 * Before this, "Cook + Process Time" was a hand-typed total that ignored the
 * cook time field — Beef Mince carried 6 against a 25-minute cook.
 *
 * Missing pieces are reported, never silently guessed at: a meat with only
 * one of the two still gets a lead time (the one it has) plus a warning.
 */
export interface MeatLead {
  /** Minutes before building it must go in; null = nothing known. */
  minutes: number | null;
  /** What's missing, for the schedule's "times incomplete" line. */
  missing: "cook" | "process" | "both" | null;
}

/**
 * Grace (migration 0290, 2026-10-27) is the cover added on top — how long the
 * cooked meat may sit ready before it's needed. Unset grace is 0, never
 * "missing": it's optional cover, not part of getting the meat cooked.
 */
export function meatLeadMinutes(
  cookMinutes: number | null | undefined,
  processMinutes: number | null | undefined,
  graceMinutes?: number | null,
): MeatLead {
  const cook = cookMinutes != null && Number.isFinite(cookMinutes) && cookMinutes >= 0 ? cookMinutes : null;
  const process = processMinutes != null && Number.isFinite(processMinutes) && processMinutes >= 0 ? processMinutes : null;
  const grace = graceMinutes != null && Number.isFinite(graceMinutes) && graceMinutes > 0 ? graceMinutes : 0;
  if (cook == null && process == null) return { minutes: null, missing: "both" };
  return {
    minutes: (cook ?? 0) + (process ?? 0) + grace,
    missing: cook == null ? "cook" : process == null ? "process" : null,
  };
}

export function meatLeadWarning(recipeName: string, meatName: string, lead: MeatLead): string | null {
  switch (lead.missing) {
    case "both": return `${recipeName}: ${meatName} has no cook or process time set`;
    case "cook": return `${recipeName}: ${meatName} has no cook time set — using process time only`;
    case "process": return `${recipeName}: ${meatName} has no process time set — counted as 0`;
    default: return null;
  }
}
