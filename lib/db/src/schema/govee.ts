/**
 * Govee temperature-sensor integration + web-push subscriptions.
 *
 * `govee_sensors`  — one row per discovered Govee thermometer, mapped to a
 *                    storage location (walk-in fridge / freezer). Also caches
 *                    the latest reading so the live tile and checklist prefill
 *                    can read instantly without hitting Govee on every request.
 * `govee_readings` — append-only history of readings (for HACCP cold-chain
 *                    reports), written by the background poller.
 * `push_subscriptions` — one row per browser/device a user has opted in on,
 *                    used to deliver web-push alerts.
 *
 * Feature toggles, thresholds and alert recipients live in `app_settings`
 * (govee_* keys) — see api-server lib/govee-settings.ts.
 */
import { pgTable, serial, text, integer, numeric, boolean, timestamp, unique, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { storageLocationsTable } from "./ordering";
import { usersTable } from "./users";

export const goveeSensorsTable = pgTable("govee_sensors", {
  id: serial("id").primaryKey(),
  // Govee device MAC-style id, unique per physical sensor.
  device: text("device").notNull().unique(),
  sku: text("sku").notNull().default(""),
  // Govee's own device name (editable in their app), shown as a default label.
  name: text("name").notNull().default(""),
  // Mapping to one of the app's storage locations. Null = unmapped/ignored.
  storageLocationId: integer("storage_location_id").references(() => storageLocationsTable.id, { onDelete: "set null" }),
  // Whether this sensor participates in the live tile / history / alerts.
  enabled: boolean("enabled").notNull().default(true),
  // Cached latest reading (Celsius), refreshed by the poller / live fetch.
  lastTemperatureC: numeric("last_temperature_c", { precision: 5, scale: 1 }),
  lastHumidityPercent: integer("last_humidity_percent"),
  lastOnline: boolean("last_online"),
  lastReadingAt: timestamp("last_reading_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const goveeReadingsTable = pgTable("govee_readings", {
  id: serial("id").primaryKey(),
  device: text("device").notNull(),
  temperatureC: numeric("temperature_c", { precision: 5, scale: 1 }),
  humidityPercent: integer("humidity_percent"),
  online: boolean("online").notNull().default(true),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
}, (table) => [
  index("ix_govee_readings_device_time").on(table.device, table.recordedAt),
]);

export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  // Push service endpoint URL — unique per subscription/device.
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
}, (table) => [
  index("ix_push_subscriptions_user").on(table.userId),
]);

export const insertGoveeSensorSchema = createInsertSchema(goveeSensorsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGoveeReadingSchema = createInsertSchema(goveeReadingsTable).omit({ id: true });
export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptionsTable).omit({ id: true, createdAt: true, lastSeenAt: true });

export type GoveeSensor = typeof goveeSensorsTable.$inferSelect;
export type GoveeReading = typeof goveeReadingsTable.$inferSelect;
export type PushSubscription = typeof pushSubscriptionsTable.$inferSelect;
