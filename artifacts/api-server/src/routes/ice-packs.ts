// Despatch ice-pack rule.
//
// Packers need to know how many ice packs to put in each box today. The rule is
// purely weather-driven: take the highest forecast temperature over the
// despatch window (today + tomorrow) for one fixed point (Heathrow / west
// London), regardless of each order's destination, and map it onto a tiered
// rule for small boxes. Large boxes always get the small-box count + 1.
//
// The rule parameters live in app_settings under `ice_pack_rules` (admin-edited
// in Settings). This route reads that config, asks the weather service for the
// high temp, and returns the computed pack counts for the packing station and
// the scanning app to display.

import { Router, type IRouter } from "express";
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getDespatchHighTemp } from "../services/weather";

const router: IRouter = Router();

const RULES_KEY = "ice_pack_rules";

interface IcePackTier {
  /** Apply this tier when the (rounded) high temp is BELOW this value, in °C.
   *  null = the open-ended top tier ("and above"). */
  maxTempBelow: number | null;
  packs: number;
}

interface IcePackRules {
  enabled: boolean;
  location: { name: string; latitude: number; longitude: number };
  largeBoxExtra: number;
  /** Ascending by threshold; exactly one tier has maxTempBelow === null. */
  tiers: IcePackTier[];
}

// Graeme's rule (2026-06): <10°C → 1, 10–under-25°C → 2, ≥25°C → 3.
// Large box = small + 1. Heathrow is the single reference point.
const DEFAULT_RULES: IcePackRules = {
  enabled: true,
  location: { name: "Heathrow", latitude: 51.47, longitude: -0.45 },
  largeBoxExtra: 1,
  tiers: [
    { maxTempBelow: 10, packs: 1 },
    { maxTempBelow: 25, packs: 2 },
    { maxTempBelow: null, packs: 3 },
  ],
};

async function loadRules(): Promise<IcePackRules> {
  try {
    const [row] = await db
      .select()
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, RULES_KEY));
    if (!row?.value) return DEFAULT_RULES;
    const parsed = JSON.parse(row.value) as Partial<IcePackRules>;
    return {
      enabled: parsed.enabled ?? DEFAULT_RULES.enabled,
      location: parsed.location ?? DEFAULT_RULES.location,
      largeBoxExtra: parsed.largeBoxExtra ?? DEFAULT_RULES.largeBoxExtra,
      tiers:
        Array.isArray(parsed.tiers) && parsed.tiers.length > 0
          ? parsed.tiers
          : DEFAULT_RULES.tiers,
    };
  } catch {
    return DEFAULT_RULES;
  }
}

/** Pick the small-box pack count for a temperature from the tier rule. */
function smallBoxPacksFor(highTemp: number, tiers: IcePackTier[]): number {
  // Compare on the rounded whole degree — matches what a person reads off a
  // weather app, and rounds 24.5 up to 25 (erring toward more ice).
  const t = Math.round(highTemp);
  // Open-ended tier (maxTempBelow null) sorts last.
  const ordered = [...tiers].sort((a, b) => {
    if (a.maxTempBelow === null) return 1;
    if (b.maxTempBelow === null) return -1;
    return a.maxTempBelow - b.maxTempBelow;
  });
  for (const tier of ordered) {
    if (tier.maxTempBelow === null || t < tier.maxTempBelow) return tier.packs;
  }
  // Shouldn't happen if a null tier exists; fall back to the highest count.
  return Math.max(...tiers.map(x => x.packs));
}

/** The whole /today computation, shared with the checklist's ice_packs
 *  dynamic-data block (2026-08-20) so the opening check can SHOW the counts
 *  instead of sending the packer to another screen to find them. */
export async function computeIcePacksToday(): Promise<Record<string, unknown>> {
  const rules = await loadRules();

  if (!rules.enabled) return { enabled: false };

  const { reading, source } = await getDespatchHighTemp(
    rules.location.latitude,
    rules.location.longitude,
  );

  const highestPacks = Math.max(...rules.tiers.map(t => t.packs));

  if (!reading) {
    // No forecast and no cached fallback — err on the side of more ice so the
    // team never under-packs on a hot day. Flag it clearly.
    return {
      enabled: true,
      forecastSource: "fallback",
      highTemp: null,
      smallBoxPacks: highestPacks,
      largeBoxPacks: highestPacks + rules.largeBoxExtra,
      location: rules.location,
      days: [],
      asOf: null,
      message: "Weather unavailable — defaulting to the hot-day pack count. Check manually.",
    };
  }

  const smallBoxPacks = smallBoxPacksFor(reading.highTemp, rules.tiers);
  return {
    enabled: true,
    forecastSource: source, // "live" | "cached"
    highTemp: Math.round(reading.highTemp),
    highTempRaw: reading.highTemp,
    smallBoxPacks,
    largeBoxPacks: smallBoxPacks + rules.largeBoxExtra,
    location: rules.location,
    days: reading.days,
    asOf: reading.fetchedAt,
  };
}

router.get("/today", async (_req, res) => {
  res.json(await computeIcePacksToday());
});

export default router;
