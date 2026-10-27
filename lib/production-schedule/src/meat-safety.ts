// The 4-hour rule as EVIDENCE (Graeme, 27 Oct 2026): cooked meat must be
// built, baked and chilled to 8 °C within 240 minutes of coming out of the
// prep oven. The schedule doesn't plan from an assumed chill time — it keeps
// meat sitting as little as possible, which is what keeps this easy. When the
// chill IS measured (a registered probe, or a plausible "mark as chilled"
// tap), the daily review records out-of-oven → chilled for the HACCP log.
//
// Wall-clock / epoch ms as noted; pure.

/** Out of the prep oven → last batch chilled to 8 °C, minutes. The HACCP rule. */
export const COOKED_TO_CHILLED_LIMIT_MINUTES = 240;

// ── Chill time: where it comes from ─────────────────────────────────────────
// Graeme (27 Oct 2026): "We have a 'mark as chilled' button, but we don't
// reliably push it when it gets down to 8°." In order of trust:
//   (a) PROBE — a continuous probe registered to the recipe for the day: the
//       first reading at or below 8 °C after the recipe's last bake;
//   (b) TAP   — the "mark as chilled" tap, only when plausible: not sooner
//       than a real chill could take, not hours late;
//   otherwise nothing — no assumed chill time is ever recorded as evidence.

export interface ChillRules {
  targetC: number;
  /** A tap sooner than this after the last bake can't be a real chill. */
  minPlausibleMinutes: number;
  /** A tap later than this was pressed long after the fact. */
  maxPlausibleMinutes: number;
}

export const CHILL_RULES: Readonly<ChillRules> = { targetC: 8, minPlausibleMinutes: 45, maxPlausibleMinutes: 210 };

export interface ChillResolution {
  /** When the last batch reached 8 °C. */
  chilledAtMs: number;
  minutes: number;
  source: "probe" | "tap";
}

export function resolveChillMinutes(input: {
  /** The recipe's last batch out of the calzone oven. */
  lastBakeAtMs: number | null;
  /** Probe readings for this recipe on this day (any order). */
  probeReadings?: Array<{ atMs: number; tempC: number }> | null;
  /** The "mark as chilled" tap for the last batch. */
  chilledTapAtMs?: number | null;
}, rules: ChillRules = CHILL_RULES): ChillResolution | null {
  const bake = input.lastBakeAtMs;
  if (bake != null && input.probeReadings?.length) {
    const hit = input.probeReadings
      .filter(r => r.atMs > bake && r.tempC <= rules.targetC)
      .sort((a, b) => a.atMs - b.atMs)[0];
    if (hit) return { chilledAtMs: hit.atMs, minutes: Math.round((hit.atMs - bake) / 60_000), source: "probe" };
  }
  if (bake != null && input.chilledTapAtMs != null) {
    const m = (input.chilledTapAtMs - bake) / 60_000;
    if (m >= rules.minPlausibleMinutes && m <= rules.maxPlausibleMinutes) return { chilledAtMs: input.chilledTapAtMs, minutes: Math.round(m), source: "tap" };
  }
  return null;
}
