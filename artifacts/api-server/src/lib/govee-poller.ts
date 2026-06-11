// Background poller for Govee sensors.
//
// A single self-scheduling loop (recursive setTimeout) that re-reads settings
// each cycle, so toggling features or changing the cadence in Settings takes
// effect on the next cycle without a restart. Kept deliberately lean — one
// Govee fetch per cycle, small writes — because a heavy 5-min poller has
// contributed to memory pressure on Railway before.
//
// Each cycle (when enabled):
//   • refresh each sensor's cached latest reading (powers the live tile)
//   • if history is on, append a row to govee_readings
//   • if alerts are on, evaluate sustained breaches and notify (email + push)

import { db, goveeSensorsTable, goveeReadingsTable, storageLocationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAllReadings, isGoveeConfigured, type GoveeReading } from "../services/govee";
import { getGoveeSettings, type GoveeSettings } from "./govee-settings";
import { sendEmail } from "./email";
import { sendPushToUsers } from "../services/push";
import { isStaging } from "./app-env";

let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

// device → epoch ms when it first went out of range (null = in range).
const breachStartByDevice = new Map<string, number>();
// device → epoch ms we last sent an alert (cooldown so we don't re-nag).
const lastAlertByDevice = new Map<string, number>();
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour between repeat alerts per device

function thresholdFor(zone: string | null, settings: GoveeSettings): number | null {
  if (zone === "freezer") return settings.freezerMaxC;
  if (zone === "fridge") return settings.fridgeMaxC;
  return null;
}

async function cacheReading(reading: GoveeReading): Promise<void> {
  await db
    .insert(goveeSensorsTable)
    .values({
      device: reading.device,
      sku: reading.sku,
      name: reading.deviceName,
      lastTemperatureC: reading.temperatureC != null ? String(reading.temperatureC) : null,
      lastHumidityPercent: reading.humidityPercent,
      lastOnline: reading.online,
      lastReadingAt: new Date(reading.fetchedAt),
    })
    .onConflictDoUpdate({
      target: goveeSensorsTable.device,
      set: {
        lastTemperatureC: reading.temperatureC != null ? String(reading.temperatureC) : null,
        lastHumidityPercent: reading.humidityPercent,
        lastOnline: reading.online,
        lastReadingAt: new Date(reading.fetchedAt),
        updatedAt: new Date(),
      },
    });
}

function alertEmailHtml(locationName: string, tempC: number, thresholdC: number): string {
  return `
    <div style="font-family:system-ui,sans-serif;max-width:480px">
      <h2 style="color:#b91c1c;margin:0 0 8px">⚠️ Temperature alert</h2>
      <p style="font-size:16px;margin:0 0 4px"><strong>${locationName}</strong> is out of range.</p>
      <p style="font-size:28px;font-weight:700;margin:8px 0">${tempC.toFixed(1)}°C
        <span style="font-size:14px;font-weight:400;color:#6b7280">(safe ≤ ${thresholdC}°C)</span></p>
      <p style="font-size:13px;color:#6b7280">Check the unit and the load. This alert repeats at most hourly while it stays out of range.</p>
    </div>`;
}

async function evaluateAlerts(
  sensors: Array<{ device: string; locationName: string | null; zone: string | null; temperatureC: number | null }>,
  settings: GoveeSettings,
): Promise<void> {
  const now = Date.now();
  const breachWindowMs = settings.alertBreachMinutes * 60 * 1000;

  for (const s of sensors) {
    const threshold = thresholdFor(s.zone, settings);
    const breaching = s.temperatureC != null && threshold != null && s.temperatureC > threshold;

    if (!breaching) {
      breachStartByDevice.delete(s.device);
      continue;
    }
    const startedAt = breachStartByDevice.get(s.device) ?? now;
    if (!breachStartByDevice.has(s.device)) breachStartByDevice.set(s.device, now);

    // Only fire once the breach has been sustained long enough.
    if (now - startedAt < breachWindowMs) continue;
    const lastAlert = lastAlertByDevice.get(s.device) ?? 0;
    if (now - lastAlert < ALERT_COOLDOWN_MS) continue;

    lastAlertByDevice.set(s.device, now);
    const label = s.locationName ?? s.device;
    const tempC = s.temperatureC!;
    const thr = threshold!;
    console.warn(`[govee] ALERT ${label}: ${tempC}°C > ${thr}°C (sustained)`);

    // Email
    if (settings.alertEmail) {
      sendEmail({
        to: settings.alertEmail,
        subject: `⚠️ ${label} temperature alert: ${tempC.toFixed(1)}°C`,
        html: alertEmailHtml(label, tempC, thr),
        text: `${label} is out of range: ${tempC.toFixed(1)}°C (safe ≤ ${thr}°C). Check the unit.`,
      }).catch((err) => console.error("[govee] alert email failed:", err));
    }
    // Push
    if (settings.alertRecipientUserIds.length > 0) {
      sendPushToUsers(settings.alertRecipientUserIds, {
        title: `⚠️ ${label}: ${tempC.toFixed(1)}°C`,
        body: `Out of range (safe ≤ ${thr}°C). Check the unit.`,
        url: "/reports?tab=haccp",
        tag: `govee-${s.device}`,
      }).catch((err) => console.error("[govee] alert push failed:", err));
    }
  }
}

async function runCycle(): Promise<void> {
  const settings = await getGoveeSettings();
  if (!settings.enabled || !isGoveeConfigured()) return;

  // Only the live tile needs cache refreshing without history/alerts; if all of
  // tile+history+alerts are off there's nothing to do.
  if (!settings.tileEnabled && !settings.historyEnabled && !settings.alertsEnabled) return;

  let readings: GoveeReading[] = [];
  try {
    readings = await getAllReadings(true);
  } catch (err) {
    console.error("[govee-poller] fetch failed:", err);
    return;
  }

  for (const r of readings) await cacheReading(r);

  if (settings.historyEnabled) {
    for (const r of readings) {
      await db.insert(goveeReadingsTable).values({
        device: r.device,
        temperatureC: r.temperatureC != null ? String(r.temperatureC) : null,
        humidityPercent: r.humidityPercent,
        online: r.online,
      }).catch((err) => console.error("[govee-poller] history insert failed:", err));
    }
  }

  if (settings.alertsEnabled) {
    // Join cached sensors to mapped locations to know each one's zone/threshold.
    const mapped = await db
      .select({
        device: goveeSensorsTable.device,
        enabled: goveeSensorsTable.enabled,
        locationName: storageLocationsTable.name,
        zone: storageLocationsTable.zone,
      })
      .from(goveeSensorsTable)
      .leftJoin(storageLocationsTable, eq(goveeSensorsTable.storageLocationId, storageLocationsTable.id));
    const readingByDevice = new Map(readings.map((r) => [r.device, r]));
    const sensors = mapped
      .filter((m) => m.enabled && m.zone)
      .map((m) => ({
        device: m.device,
        locationName: m.locationName,
        zone: m.zone,
        temperatureC: readingByDevice.get(m.device)?.temperatureC ?? null,
      }));
    await evaluateAlerts(sensors, settings);
  }
}

async function loop(): Promise<void> {
  if (!running) return;
  let nextDelayMs = 10 * 60 * 1000;
  try {
    const settings = await getGoveeSettings();
    nextDelayMs = Math.max(2, settings.pollMinutes) * 60 * 1000;
    await runCycle();
  } catch (err) {
    console.error("[govee-poller] cycle error:", err);
  } finally {
    if (running) timer = setTimeout(() => { void loop(); }, nextDelayMs);
  }
}

export function startGoveePoller(): void {
  if (running) return;
  if (isStaging()) {
    console.log("[govee-poller] staging: scheduler disabled");
    return;
  }
  running = true;
  // First cycle shortly after boot, then on the configured cadence.
  timer = setTimeout(() => { void loop(); }, 15_000);
  console.log("[govee-poller] scheduler started");
}

export function stopGoveePoller(): void {
  running = false;
  if (timer) { clearTimeout(timer); timer = null; }
}
