/**
 * Server-side daily PIN lock for writes that record work against a person.
 * The rules and the list of guarded endpoints live in lib/pin-enforce.ts
 * (tested); this file only supplies the kill-switch read.
 *
 * Kill switch: app_settings key feature_server_pin_enforce — 'false' turns
 * enforcement off; anything else (including no row) leaves it on.
 */
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createPinEnforceMiddleware, PIN_ENFORCE_SETTING_KEY } from "../lib/pin-enforce";

export const requireFreshPinForAttributingWrites = createPinEnforceMiddleware({
  readSetting: async () => {
    const [row] = await db
      .select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, PIN_ENFORCE_SETTING_KEY));
    return row?.value ?? null;
  },
});
