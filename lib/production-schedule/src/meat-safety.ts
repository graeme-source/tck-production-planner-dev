// The 4-hour rule for cooked meat (Graeme, 27 Oct 2026): "It needs to be
// built, go through the oven, and chill down to 8° within 4 hours of it being
// cooked... It generally takes about 2 hours to chill. E.g. cook, then 30 min
// processing, then they build that recipe for 1 hour = 1.5 hours out, then 2
// hours to chill = 3.5 hours total to 8°, which is fine."
//
// THE RULE: from the meat coming OUT of the prep oven to that recipe's LAST
// batch built + baked + chilled to 8 °C must be ≤ totalMinutes (240).
// So the longest the meat may be out before the last batch is BUILT is
//
//     maxSpan = total − chill − bake          (240 − 120 − ~13 ≈ 107 min)
//
// PLANNING WITH IT: one cook covers (maxSpan − processing − buffer) minutes
// of building. A longer build is split into the fewest WAVES that comply,
// balanced into equal shares; each wave comes out of the oven processing +
// buffer before its share starts, and its share follows the build pace.
//
// Wall-clock minutes since London midnight; pure.

export interface SafetyRule {
  /** Out of the oven → last batch chilled to 8 °C, minutes. 240. */
  totalMinutes: number;
  /** Baked calzones chilling to 8 °C, minutes. Setting, default 120. */
  chillMinutes: number;
  /** Last batch built → out of the calzone oven, minutes (learned from the ovens station). */
  bakeMinutes: number;
}

export const DEFAULT_SAFETY_RULE: Readonly<SafetyRule> = { totalMinutes: 240, chillMinutes: 120, bakeMinutes: 15 };

/** Longest the cooked meat may be out before the recipe's last batch is built. */
export function maxOutToLastBuiltMinutes(rule: SafetyRule): number {
  return Math.max(0, rule.totalMinutes - rule.chillMinutes - rule.bakeMinutes);
}

/** Out of the prep oven → last batch chilled to 8 °C (predicted). */
export function minutesToChilled(outAtMinutes: number, lastBuiltAtMinutes: number, rule: SafetyRule): number {
  return lastBuiltAtMinutes + rule.bakeMinutes + rule.chillMinutes - outAtMinutes;
}

export interface MeatWave {
  /** 1-based. */
  wave: number;
  /** In the prep oven by. */
  putInMinutes: number;
  /** Out of the oven by. */
  outMinutes: number;
  /** The builders start on this wave's meat… */
  neededFromMinutes: number;
  /** …and must have built its last batch by this time. */
  neededToMinutes: number;
  /** This wave's share of the recipe's batches (whole batches, adding up to the total). */
  batches: number;
}

export interface WavePlan {
  waves: MeatWave[];
  /** Even split into waves can't comply: maxSpan is no longer than processing + buffer. */
  impossible: boolean;
}

export interface WaveInput {
  /** When the builders start the recipe. */
  startMinutes: number;
  /** When they'll build its last batch. */
  finishMinutes: number;
  batches: number;
  cookMinutes: number;
  processMinutes: number;
  bufferMinutes: number;
  maxSpanMinutes: number;
  /** Safety valve. */
  maxWaves?: number;
}

export function planMeatWaves(input: WaveInput): WavePlan {
  const maxWaves = input.maxWaves ?? 6;
  const ahead = input.processMinutes + input.bufferMinutes;
  const span = Math.max(0, input.finishMinutes - input.startMinutes);
  // Building time one cook can cover: the meat is out `ahead` minutes before
  // its share starts, and may be out at most maxSpan before its last batch.
  const cover = input.maxSpanMinutes - ahead;
  const impossible = span > 0 && cover <= 0;
  // As few waves as the rule allows, then BALANCED — equal shares, rather
  // than one big cook and a one-batch straggler.
  const n = impossible ? 1 : Math.min(maxWaves, Math.max(1, Math.ceil(span / cover - 1e-9)));
  const waves: MeatWave[] = [];
  let given = 0;
  for (let k = 0; k < n; k++) {
    const from = input.startMinutes + (span * k) / n;
    const to = input.startMinutes + (span * (k + 1)) / n;
    const out = from - ahead;
    const batches = k === n - 1 ? Math.max(0, input.batches - given) : Math.round(input.batches / n);
    given += batches;
    waves.push({
      wave: k + 1,
      putInMinutes: Math.round(out - input.cookMinutes),
      outMinutes: Math.round(out),
      neededFromMinutes: Math.round(from),
      neededToMinutes: Math.round(to),
      batches,
    });
  }
  return { waves, impossible };
}

// ── Chill time: where it comes from ─────────────────────────────────────────
// Graeme (27 Oct 2026): "We have a 'mark as chilled' button, but we don't
// reliably push it when it gets down to 8°." In order of trust:
//   (a) PROBE — a continuous probe registered to the recipe for the day: the
//       first reading at or below 8 °C after the recipe's last bake;
//   (b) TAP   — the "mark as chilled" tap, only when plausible: not sooner
//       than a real chill could take, not hours late;
//   (c) DEFAULT — the Settings chill time (120).

export interface ChillRules {
  targetC: number;
  /** A tap sooner than this after the last bake can't be a real chill. */
  minPlausibleMinutes: number;
  /** A tap later than this was pressed long after the fact. */
  maxPlausibleMinutes: number;
}

export const CHILL_RULES: Readonly<ChillRules> = { targetC: 8, minPlausibleMinutes: 45, maxPlausibleMinutes: 210 };

export interface ChillResolution {
  minutes: number;
  source: "probe" | "tap" | "default";
}

export function resolveChillMinutes(input: {
  /** The recipe's last batch out of the calzone oven. */
  lastBakeAtMs: number | null;
  /** Probe readings for this recipe on this day (any order). */
  probeReadings?: Array<{ atMs: number; tempC: number }> | null;
  /** The "mark as chilled" tap for the last batch. */
  chilledTapAtMs?: number | null;
  defaultMinutes: number;
}, rules: ChillRules = CHILL_RULES): ChillResolution {
  const bake = input.lastBakeAtMs;
  if (bake != null && input.probeReadings?.length) {
    const hit = input.probeReadings
      .filter(r => r.atMs > bake && r.tempC <= rules.targetC)
      .sort((a, b) => a.atMs - b.atMs)[0];
    if (hit) return { minutes: Math.round((hit.atMs - bake) / 60_000), source: "probe" };
  }
  if (bake != null && input.chilledTapAtMs != null) {
    const m = (input.chilledTapAtMs - bake) / 60_000;
    if (m >= rules.minPlausibleMinutes && m <= rules.maxPlausibleMinutes) return { minutes: Math.round(m), source: "tap" };
  }
  return { minutes: input.defaultMinutes, source: "default" };
}
