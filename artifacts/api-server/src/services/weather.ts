// Weather lookup for the despatch ice-pack rule.
//
// We only ever need one number: the highest forecast daytime temperature over
// the despatch window (today + tomorrow) for a single point — Heathrow / west
// London — regardless of where each customer's order is going. Source is
// Open-Meteo (https://open-meteo.com): free, no API key, good UK coverage.
//
// Resilience: the forecast is cached in-memory for a few hours and the last
// successful reading is persisted to app_settings, so a transient Open-Meteo
// outage never blanks out the packing instruction. If we have nothing at all,
// the caller decides the safe fallback (treat as a hot day).

import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const WEATHER_CACHE_KEY = "ice_pack_weather_cache";
const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours

export interface WeatherReading {
  /** Highest daily max temperature (°C) across today + tomorrow. */
  highTemp: number;
  /** Per-day daily max temps used, in order [today, tomorrow]. */
  days: Array<{ date: string; maxTemp: number }>;
  /** When this reading was fetched (ISO instant). */
  fetchedAt: string;
}

export interface WeatherResult {
  reading: WeatherReading | null;
  /** "live" = just fetched, "cached" = served from a stale earlier reading. */
  source: "live" | "cached";
}

let memoryCache: WeatherReading | null = null;

function isFresh(reading: WeatherReading): boolean {
  return Date.now() - new Date(reading.fetchedAt).getTime() < CACHE_TTL_MS;
}

async function readPersistedCache(): Promise<WeatherReading | null> {
  try {
    const [row] = await db
      .select()
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, WEATHER_CACHE_KEY));
    if (!row?.value) return null;
    return JSON.parse(row.value) as WeatherReading;
  } catch {
    return null;
  }
}

async function writePersistedCache(reading: WeatherReading): Promise<void> {
  try {
    const value = JSON.stringify(reading);
    await db
      .insert(appSettingsTable)
      .values({ key: WEATHER_CACHE_KEY, value })
      .onConflictDoUpdate({
        target: appSettingsTable.key,
        set: { value, updatedAt: new Date() },
      });
  } catch (err) {
    console.error("[weather] Failed to persist forecast cache:", err);
  }
}

async function fetchForecast(latitude: number, longitude: number): Promise<WeatherReading> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    `&daily=temperature_2m_max&forecast_days=2&timezone=Europe%2FLondon`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Open-Meteo responded ${res.status}`);
  const json = (await res.json()) as {
    daily?: { time?: string[]; temperature_2m_max?: number[] };
  };
  const times = json.daily?.time ?? [];
  const maxes = json.daily?.temperature_2m_max ?? [];
  if (times.length === 0 || maxes.length === 0) {
    throw new Error("Open-Meteo returned no daily temperatures");
  }
  const days = times.map((date, i) => ({ date, maxTemp: maxes[i] }))
    .filter(d => typeof d.maxTemp === "number");
  if (days.length === 0) throw new Error("Open-Meteo returned no usable temperatures");
  const highTemp = Math.max(...days.map(d => d.maxTemp));
  return { highTemp, days, fetchedAt: new Date().toISOString() };
}

/**
 * Highest forecast temperature over today + tomorrow for the given point.
 * Returns the freshest reading available; `reading` is null only if we have
 * never successfully reached Open-Meteo and have no persisted fallback.
 */
export async function getDespatchHighTemp(
  latitude: number,
  longitude: number,
): Promise<WeatherResult> {
  if (memoryCache && isFresh(memoryCache)) {
    return { reading: memoryCache, source: "live" };
  }
  try {
    const reading = await fetchForecast(latitude, longitude);
    memoryCache = reading;
    await writePersistedCache(reading);
    return { reading, source: "live" };
  } catch (err) {
    console.error("[weather] Forecast fetch failed, falling back to cache:", err);
    const cached = memoryCache ?? (await readPersistedCache());
    if (cached) {
      memoryCache = cached;
      return { reading: cached, source: "cached" };
    }
    return { reading: null, source: "cached" };
  }
}
