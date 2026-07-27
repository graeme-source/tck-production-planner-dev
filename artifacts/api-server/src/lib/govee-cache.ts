// Shared Govee reading cache + frozen-value detection.
//
// Govee's cloud API keeps answering `online: true` with the sensor's
// last-known numbers for a long time after the sensor actually stops
// transmitting (dead battery, in practice). Trusting that flag left the
// dashboard showing a frozen value as "Live" — discovered 2026-07-27 when the
// walk-in freezer flatlined at -16.2°C for over an hour while the Govee phone
// app (which talks Bluetooth, so it knows) showed disconnected + battery alarm.
//
// The tell is unmistakable in history: temperature AND humidity byte-identical
// across the whole stale window. A real chamber never does that — compressors
// cycle and humidity wobbles constantly. So: if every reading in the window is
// identical while Govee claims online, we treat the sensor as offline. That
// flips `lastOnline` to false, which drives the dashboard stale badge and the
// poller's "check or replace its battery" push through the existing paths.
//
// Requires reading history (settings.historyEnabled) — without rows to compare
// we can't tell a frozen value from a stable one, so detection quietly skips.

import { db, goveeSensorsTable, goveeReadingsTable } from "@workspace/db";
import { and, asc, eq, gte } from "drizzle-orm";
import type { GoveeReading } from "../services/govee";

// Minimum identical history rows before we call it frozen. At the default
// 10-minute poll cadence this is 30 minutes of flatline inside the (default
// 60-minute) stale window — enough that a genuinely rock-steady chamber
// holding BOTH values to the decimal is vanishingly unlikely.
const MIN_FLATLINE_SAMPLES = 3;

interface FrozenCheck {
  frozen: boolean;
  /** recorded_at of the earliest reading in the flatline run (best estimate
   *  of when the sensor actually died). */
  flatSince: Date | null;
}

async function detectFrozen(reading: GoveeReading, staleMinutes: number): Promise<FrozenCheck> {
  if (!reading.online || reading.temperatureC == null) return { frozen: false, flatSince: null };

  const windowStart = new Date(Date.now() - staleMinutes * 60_000);
  const rows = await db
    .select({
      temperatureC: goveeReadingsTable.temperatureC,
      humidityPercent: goveeReadingsTable.humidityPercent,
      online: goveeReadingsTable.online,
      recordedAt: goveeReadingsTable.recordedAt,
    })
    .from(goveeReadingsTable)
    .where(and(
      eq(goveeReadingsTable.device, reading.device),
      gte(goveeReadingsTable.recordedAt, windowStart),
    ))
    .orderBy(asc(goveeReadingsTable.recordedAt));

  if (rows.length < MIN_FLATLINE_SAMPLES) return { frozen: false, flatSince: null };

  const identical = rows.every((r) =>
    r.online &&
    r.temperatureC != null &&
    Number(r.temperatureC) === reading.temperatureC &&
    (r.humidityPercent ?? null) === (reading.humidityPercent ?? null),
  );
  if (!identical) return { frozen: false, flatSince: null };

  return { frozen: true, flatSince: rows[0].recordedAt };
}

/** Upsert a discovered sensor + cache its latest reading, demoting suspected
 *  frozen cloud values to offline so the stale badge and battery push fire. */
export async function cacheReading(reading: GoveeReading, staleMinutes: number): Promise<void> {
  const readingAt = new Date(reading.fetchedAt);

  const { frozen, flatSince } = await detectFrozen(reading, staleMinutes);
  const effectiveOnline = reading.online && !frozen;

  const [prev] = await db
    .select({ lastOnline: goveeSensorsTable.lastOnline, lastOnlineAt: goveeSensorsTable.lastOnlineAt })
    .from(goveeSensorsTable)
    .where(eq(goveeSensorsTable.device, reading.device));

  // Freshness clock: advance while genuinely online. On the transition into
  // frozen, backdate to the start of the flatline — that's when the sensor
  // really died, not when we finally noticed. While offline/frozen, hold the
  // previous value so the UI can show how long it's been dark.
  let lastOnlineAt: Date | null;
  if (effectiveOnline) {
    lastOnlineAt = readingAt;
  } else if (frozen && prev?.lastOnline !== false && flatSince) {
    lastOnlineAt = flatSince;
    console.warn(`[govee] FROZEN readings from ${reading.deviceName || reading.device}: identical since ${flatSince.toISOString()} while cloud claims online — treating as offline (suspected dead battery)`);
  } else {
    lastOnlineAt = prev?.lastOnlineAt ?? null;
  }

  await db
    .insert(goveeSensorsTable)
    .values({
      device: reading.device,
      sku: reading.sku,
      name: reading.deviceName,
      lastTemperatureC: reading.temperatureC != null ? String(reading.temperatureC) : null,
      lastHumidityPercent: reading.humidityPercent,
      lastOnline: effectiveOnline,
      lastReadingAt: readingAt,
      lastOnlineAt,
    })
    .onConflictDoUpdate({
      target: goveeSensorsTable.device,
      set: {
        sku: reading.sku,
        lastTemperatureC: reading.temperatureC != null ? String(reading.temperatureC) : null,
        lastHumidityPercent: reading.humidityPercent,
        lastOnline: effectiveOnline,
        lastReadingAt: readingAt,
        lastOnlineAt,
        updatedAt: new Date(),
      },
    });
}
