// Govee temperature-sensor + web-push API.
//
// Mounted at /api/govee for any logged-in user. Read endpoints (live tile,
// history, push subscribe/test) are open to all authenticated users; config
// endpoints (sensor mapping, settings, sync, recipients) are admin-only via the
// inline `adminOnly` guard.

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  db,
  goveeSensorsTable,
  goveeReadingsTable,
  pushSubscriptionsTable,
  storageLocationsTable,
  usersTable,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  isGoveeConfigured,
  listThermometers,
  getAllReadings,
  type GoveeReading as GoveeLiveReading,
} from "../services/govee";
import {
  getVapidPublicKey,
  isPushConfigured,
  sendPushToUser,
  getUsersWithPush,
} from "../services/push";
import { getGoveeSettings, setGoveeSettings, type GoveeSettings } from "../lib/govee-settings";
import { cacheReading } from "../lib/govee-cache";
import { requireFeature } from "../lib/feature-access";

const router: IRouter = Router();

// Admins, plus anyone handed the Temperature Sensors area in Settings →
// Team & Access. It used to be admin-or-nothing, which meant asking someone
// to map the fridge sensors required making them an admin first
// (Graeme, 2026-09-04).
const adminOnly = requireFeature("settings.sensors");

// ── Helpers ─────────────────────────────────────────────────────────

function thresholdFor(zone: string | null, settings: GoveeSettings): number | null {
  if (zone === "freezer") return settings.freezerMaxC;
  if (zone === "fridge") return settings.fridgeMaxC;
  return null;
}

// ── Status / live readings ──────────────────────────────────────────

router.get("/status", async (_req: Request, res: Response) => {
  const settings = await getGoveeSettings();
  res.json({
    configured: isGoveeConfigured(),
    pushConfigured: isPushConfigured(),
    vapidPublicKey: getVapidPublicKey(),
    settings,
  });
});

/** Live readings for the dashboard tile. Fetches fresh from Govee (with the
 *  service's short cache), refreshes the cached row, and joins to the mapped
 *  storage location so the UI can show "Walk-in Fridge: 2.6°C". */
router.get("/live", async (_req: Request, res: Response) => {
  const settings = await getGoveeSettings();
  if (!settings.enabled || !isGoveeConfigured()) {
    res.json({ enabled: false, tileEnabled: settings.tileEnabled, sensors: [] });
    return;
  }

  let readings: GoveeLiveReading[] = [];
  try {
    readings = await getAllReadings();
    for (const r of readings) await cacheReading(r, settings.staleMinutes);
  } catch (err) {
    console.error("[govee] live fetch failed, falling back to cache:", err);
  }

  const sensorRows = await db
    .select({
      device: goveeSensorsTable.device,
      name: goveeSensorsTable.name,
      enabled: goveeSensorsTable.enabled,
      storageLocationId: goveeSensorsTable.storageLocationId,
      lastTemperatureC: goveeSensorsTable.lastTemperatureC,
      lastHumidityPercent: goveeSensorsTable.lastHumidityPercent,
      lastOnline: goveeSensorsTable.lastOnline,
      lastReadingAt: goveeSensorsTable.lastReadingAt,
      lastOnlineAt: goveeSensorsTable.lastOnlineAt,
      locationName: storageLocationsTable.name,
      zone: storageLocationsTable.zone,
      locTempMinC: storageLocationsTable.tempMinC,
      locTempMaxC: storageLocationsTable.tempMaxC,
    })
    .from(goveeSensorsTable)
    .leftJoin(storageLocationsTable, eq(goveeSensorsTable.storageLocationId, storageLocationsTable.id))
    .where(eq(goveeSensorsTable.enabled, true));

  const staleMs = settings.staleMinutes * 60_000;
  const now = Date.now();
  const sensors = sensorRows.map((s) => {
    const temperatureC = s.lastTemperatureC != null ? Number(s.lastTemperatureC) : null;
    // Per-location safety band (set in Stock Control) wins over the
    // zone-wide default ceiling; the zone default has no floor.
    const threshold = s.locTempMaxC != null ? Number(s.locTempMaxC) : thresholdFor(s.zone, settings);
    const minC = s.locTempMinC != null ? Number(s.locTempMinC) : null;
    const breaching = temperatureC != null && (
      (threshold != null && temperatureC > threshold) ||
      (minC != null && temperatureC < minC)
    );
    // Stale = the sensor isn't currently reporting, so the temperature shown
    // is a frozen last-known value. Covers a dead battery, dropped WiFi, or an
    // unplugged unit — anything that stops fresh data arriving.
    const online = s.lastOnline ?? null;
    const lastOnlineMs = s.lastOnlineAt ? s.lastOnlineAt.getTime() : null;
    const stale = online === false || lastOnlineMs == null || (now - lastOnlineMs) > staleMs;
    return {
      device: s.device,
      name: s.locationName ?? s.name,
      sensorName: s.name,
      storageLocationId: s.storageLocationId ?? null,
      locationName: s.locationName ?? null,
      zone: s.zone ?? null,
      temperatureC,
      humidityPercent: s.lastHumidityPercent ?? null,
      online,
      thresholdC: threshold,
      minC,
      breaching,
      readingAt: s.lastReadingAt ? s.lastReadingAt.toISOString() : null,
      lastOnlineAt: s.lastOnlineAt ? s.lastOnlineAt.toISOString() : null,
      stale,
    };
  });

  res.json({
    enabled: true,
    tileEnabled: settings.tileEnabled,
    checklistAssistEnabled: settings.checklistAssistEnabled,
    sensors,
  });
});

/** Reading history for one device (HACCP cold-chain). */
router.get("/history", async (req: Request, res: Response) => {
  const device = String(req.query.device ?? "");
  const hours = Math.min(24 * 31, Math.max(1, Number(req.query.hours) || 24));
  if (!device) { res.status(400).json({ error: "device is required" }); return; }
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const rows = await db
    .select({
      temperatureC: goveeReadingsTable.temperatureC,
      humidityPercent: goveeReadingsTable.humidityPercent,
      online: goveeReadingsTable.online,
      recordedAt: goveeReadingsTable.recordedAt,
    })
    .from(goveeReadingsTable)
    .where(and(eq(goveeReadingsTable.device, device), gte(goveeReadingsTable.recordedAt, since)))
    .orderBy(desc(goveeReadingsTable.recordedAt))
    .limit(5000);
  res.json(rows.map((r) => ({
    temperatureC: r.temperatureC != null ? Number(r.temperatureC) : null,
    humidityPercent: r.humidityPercent ?? null,
    online: r.online,
    recordedAt: r.recordedAt.toISOString(),
  })));
});

// ── Web push (any logged-in user, scoped to themselves) ─────────────

router.get("/push/public-key", (_req: Request, res: Response) => {
  res.json({ publicKey: getVapidPublicKey() });
});

router.post("/push/subscribe", async (req: Request, res: Response) => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const sub = req.body?.subscription ?? req.body;
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (!endpoint || !p256dh || !auth) { res.status(400).json({ error: "Invalid subscription" }); return; }
  await db
    .insert(pushSubscriptionsTable)
    .values({ userId, endpoint, p256dh, auth, userAgent: req.get("user-agent") ?? null })
    .onConflictDoUpdate({
      target: pushSubscriptionsTable.endpoint,
      set: { userId, p256dh, auth, userAgent: req.get("user-agent") ?? null, lastSeenAt: new Date() },
    });
  res.status(201).json({ ok: true });
});

router.post("/push/unsubscribe", async (req: Request, res: Response) => {
  const endpoint = req.body?.endpoint;
  if (!endpoint) { res.status(400).json({ error: "endpoint required" }); return; }
  await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, endpoint));
  res.json({ ok: true });
});

/** How many devices the current user has enabled. */
router.get("/push/status", async (req: Request, res: Response) => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, userId));
  res.json({ devices: row?.count ?? 0, pushConfigured: isPushConfigured() });
});

router.post("/push/test", async (req: Request, res: Response) => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const sent = await sendPushToUser(userId, {
    title: "Test alert ✅",
    body: "Temperature alerts are working on this device.",
    url: "/settings",
    tag: "govee-test",
  });
  res.json({ ok: true, devicesNotified: sent });
});

// ── Admin config ────────────────────────────────────────────────────

/** Raw Govee thermometer list (for mapping). */
router.get("/devices", adminOnly, async (_req: Request, res: Response) => {
  if (!isGoveeConfigured()) { res.json({ configured: false, devices: [] }); return; }
  try {
    const devices = await listThermometers(true);
    res.json({ configured: true, devices });
  } catch (err) {
    console.error("[govee] device list failed:", err);
    res.status(502).json({ error: "Could not reach Govee" });
  }
});

/** Discover devices from Govee and upsert them into govee_sensors. */
router.post("/sync", adminOnly, async (_req: Request, res: Response) => {
  if (!isGoveeConfigured()) { res.status(400).json({ error: "GOVEE_API_KEY not configured" }); return; }
  try {
    const devices = await listThermometers(true);
    for (const d of devices) {
      await db
        .insert(goveeSensorsTable)
        .values({ device: d.device, sku: d.sku, name: d.deviceName })
        .onConflictDoUpdate({
          target: goveeSensorsTable.device,
          set: { sku: d.sku, name: d.deviceName, updatedAt: new Date() },
        });
    }
    res.json({ ok: true, count: devices.length });
  } catch (err) {
    console.error("[govee] sync failed:", err);
    res.status(502).json({ error: "Could not reach Govee" });
  }
});

/** Configured sensors with their mapping + latest cached reading. */
router.get("/sensors", adminOnly, async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      device: goveeSensorsTable.device,
      sku: goveeSensorsTable.sku,
      name: goveeSensorsTable.name,
      enabled: goveeSensorsTable.enabled,
      storageLocationId: goveeSensorsTable.storageLocationId,
      lastTemperatureC: goveeSensorsTable.lastTemperatureC,
      lastHumidityPercent: goveeSensorsTable.lastHumidityPercent,
      lastOnline: goveeSensorsTable.lastOnline,
      lastReadingAt: goveeSensorsTable.lastReadingAt,
      locationName: storageLocationsTable.name,
      zone: storageLocationsTable.zone,
    })
    .from(goveeSensorsTable)
    .leftJoin(storageLocationsTable, eq(goveeSensorsTable.storageLocationId, storageLocationsTable.id))
    .orderBy(goveeSensorsTable.name);
  const locations = await db
    .select({ id: storageLocationsTable.id, name: storageLocationsTable.name, zone: storageLocationsTable.zone })
    .from(storageLocationsTable)
    .orderBy(storageLocationsTable.name);
  res.json({
    sensors: rows.map((s) => ({
      ...s,
      lastTemperatureC: s.lastTemperatureC != null ? Number(s.lastTemperatureC) : null,
      lastReadingAt: s.lastReadingAt ? s.lastReadingAt.toISOString() : null,
    })),
    locations,
  });
});

router.put("/sensors/:device", adminOnly, async (req: Request, res: Response) => {
  const device = String(req.params.device);
  const { storageLocationId, enabled, name } = req.body as {
    storageLocationId?: number | null; enabled?: boolean; name?: string;
  };
  const [row] = await db
    .update(goveeSensorsTable)
    .set({
      ...(storageLocationId !== undefined ? { storageLocationId: storageLocationId ?? null } : {}),
      ...(enabled !== undefined ? { enabled: !!enabled } : {}),
      ...(name !== undefined ? { name } : {}),
      updatedAt: new Date(),
    })
    .where(eq(goveeSensorsTable.device, device))
    .returning({ device: goveeSensorsTable.device });
  if (!row) { res.status(404).json({ error: "Sensor not found" }); return; }
  res.json({ ok: true });
});

// ── Settings + recipients (admin) ───────────────────────────────────

router.get("/settings", adminOnly, async (_req: Request, res: Response) => {
  res.json(await getGoveeSettings());
});

router.put("/settings", adminOnly, async (req: Request, res: Response) => {
  const body = req.body as Partial<GoveeSettings>;
  const patch: Partial<GoveeSettings> = {};
  const bools: Array<keyof GoveeSettings> = ["enabled", "tileEnabled", "historyEnabled", "alertsEnabled", "checklistAssistEnabled"];
  for (const k of bools) if (typeof body[k] === "boolean") (patch as Record<string, unknown>)[k] = body[k];
  const nums: Array<keyof GoveeSettings> = ["fridgeMaxC", "freezerMaxC", "pollMinutes", "alertBreachMinutes", "staleMinutes"];
  for (const k of nums) if (typeof body[k] === "number" && Number.isFinite(body[k])) (patch as Record<string, unknown>)[k] = body[k];
  if (typeof body.alertEmail === "string") patch.alertEmail = body.alertEmail.trim();
  if (Array.isArray(body.alertRecipientUserIds)) {
    patch.alertRecipientUserIds = body.alertRecipientUserIds.map(Number).filter(Number.isFinite);
  }
  await setGoveeSettings(patch);
  res.json(await getGoveeSettings());
});

/** App users + whether each has a push device + whether each is a selected
 *  alert recipient. Drives the recipient picker in settings. */
router.get("/recipients", adminOnly, async (_req: Request, res: Response) => {
  const settings = await getGoveeSettings();
  const users = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.isActive, true))
    .orderBy(usersTable.name);
  const withPush = await getUsersWithPush();
  const selected = new Set(settings.alertRecipientUserIds);
  res.json(users.map((u) => ({
    ...u,
    hasPushDevice: withPush.has(u.id),
    isRecipient: selected.has(u.id),
  })));
});

export default router;
