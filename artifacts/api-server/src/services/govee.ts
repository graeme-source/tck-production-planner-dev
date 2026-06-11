// Govee cloud API client — reads temperature/humidity from the kitchen's
// Govee WiFi thermometers (H5179: walk-in fridge & freezer).
//
// Auth is a single developer API key (GOVEE_API_KEY), sent in the
// `Govee-API-Key` header. The cloud API returns temperature in FAHRENHEIT;
// we convert to Celsius here so the rest of the app only ever sees °C.
//
// This module is the pure API client + light caching only — no DB writes.
// Persistence (history), scheduling (poller) and feature toggles live in
// their own layers so this stays easily testable and rate-limit friendly.
//
// Govee enforces per-key rate limits, so we cache the device list for an hour
// and individual readings for ~50s. Non-profit use only, per Govee's terms.

const BASE_URL = "https://openapi.api.govee.com/router/api/v1";
const DEVICES_TTL_MS = 60 * 60 * 1000; // 1 hour
const READING_TTL_MS = 50 * 1000; // ~50s — below the meeting/dashboard refresh
const REQUEST_TIMEOUT_MS = 12_000;

export interface GoveeDevice {
  sku: string;
  device: string;
  deviceName: string;
  /** e.g. "devices.types.thermometer" */
  type: string;
  hasTemperature: boolean;
  hasHumidity: boolean;
}

export interface GoveeReading {
  device: string;
  sku: string;
  deviceName: string;
  online: boolean;
  /** Temperature in Celsius (converted from the API's Fahrenheit). Null if unreported. */
  temperatureC: number | null;
  /** Relative humidity %. Null if unreported. */
  humidityPercent: number | null;
  /** When this reading was fetched (ISO instant). */
  fetchedAt: string;
}

export function fahrenheitToCelsius(f: number): number {
  // One decimal place — matches the app's temperature_c precision.
  return Math.round(((f - 32) * 5) / 9 * 10) / 10;
}

export function getApiKey(): string | null {
  const key = process.env["GOVEE_API_KEY"];
  return key && key.trim().length > 0 ? key.trim() : null;
}

/** True when a Govee API key is configured. The feature toggles (in
 *  app_settings) gate whether we actually use it; this only reflects config. */
export function isGoveeConfigured(): boolean {
  return getApiKey() !== null;
}

class GoveeError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "GoveeError";
  }
}

async function goveeFetch(path: string, init?: RequestInit): Promise<unknown> {
  const apiKey = getApiKey();
  if (!apiKey) throw new GoveeError("GOVEE_API_KEY is not configured");
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Govee-API-Key": apiKey,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* leave null */ }
  if (!res.ok) {
    throw new GoveeError(`Govee API ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
  return json;
}

// ── Device list (cached) ────────────────────────────────────────────

let devicesCache: { devices: GoveeDevice[]; ts: number } | null = null;

function parseDevices(json: unknown): GoveeDevice[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data.map((d): GoveeDevice => {
    const dev = d as {
      sku?: string; device?: string; deviceName?: string; type?: string;
      capabilities?: Array<{ instance?: string }>;
    };
    const instances = new Set((dev.capabilities ?? []).map(c => c.instance));
    return {
      sku: dev.sku ?? "",
      device: dev.device ?? "",
      deviceName: dev.deviceName ?? "",
      type: dev.type ?? "",
      hasTemperature: instances.has("sensorTemperature"),
      hasHumidity: instances.has("sensorHumidity"),
    };
  }).filter(d => d.device.length > 0);
}

export async function listDevices(force = false): Promise<GoveeDevice[]> {
  if (!force && devicesCache && Date.now() - devicesCache.ts < DEVICES_TTL_MS) {
    return devicesCache.devices;
  }
  const json = await goveeFetch("/user/devices", { method: "GET" });
  const devices = parseDevices(json);
  devicesCache = { devices, ts: Date.now() };
  return devices;
}

/** Thermometer-type devices only (the ones we surface as fridge/freezer probes). */
export async function listThermometers(force = false): Promise<GoveeDevice[]> {
  const all = await listDevices(force);
  return all.filter(d => d.hasTemperature);
}

// ── Single-device state (cached per device) ─────────────────────────

const readingCache = new Map<string, { reading: GoveeReading; ts: number }>();

function parseState(json: unknown, fallback: { sku: string; device: string; deviceName: string }): GoveeReading {
  const payload = (json as { payload?: unknown })?.payload as {
    sku?: string; device?: string;
    capabilities?: Array<{ instance?: string; state?: { value?: unknown } }>;
  } | undefined;
  const caps = payload?.capabilities ?? [];
  const byInstance = (name: string): unknown =>
    caps.find(c => c.instance === name)?.state?.value;

  const onlineVal = byInstance("online");
  const tempF = byInstance("sensorTemperature");
  const humidity = byInstance("sensorHumidity");

  return {
    device: payload?.device ?? fallback.device,
    sku: payload?.sku ?? fallback.sku,
    deviceName: fallback.deviceName,
    online: onlineVal === undefined ? true : Boolean(onlineVal),
    temperatureC: typeof tempF === "number" ? fahrenheitToCelsius(tempF) : null,
    humidityPercent: typeof humidity === "number" ? Math.round(humidity) : null,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getDeviceReading(
  sku: string,
  device: string,
  deviceName = "",
  force = false,
): Promise<GoveeReading> {
  const cached = readingCache.get(device);
  if (!force && cached && Date.now() - cached.ts < READING_TTL_MS) {
    return cached.reading;
  }
  const json = await goveeFetch("/device/state", {
    method: "POST",
    body: JSON.stringify({ requestId: `tck-${Date.now()}-${device}`, payload: { sku, device } }),
  });
  const reading = parseState(json, { sku, device, deviceName });
  readingCache.set(device, { reading, ts: Date.now() });
  return reading;
}

/** Current readings for every thermometer on the account. Each device is
 *  fetched independently; one failing device doesn't sink the others. */
export async function getAllReadings(force = false): Promise<GoveeReading[]> {
  const thermometers = await listThermometers(force);
  const results = await Promise.all(
    thermometers.map(async (d) => {
      try {
        return await getDeviceReading(d.sku, d.device, d.deviceName, force);
      } catch (err) {
        console.error(`[govee] reading failed for ${d.deviceName} (${d.device}):`, err);
        return null;
      }
    }),
  );
  return results.filter((r): r is GoveeReading => r !== null);
}
