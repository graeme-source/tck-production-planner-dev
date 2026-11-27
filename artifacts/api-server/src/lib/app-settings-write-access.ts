/**
 * Who may change which app setting through PUT/DELETE /api/app-settings/:key.
 * Pure rule, shared by the route guard and its regression test.
 *
 * - Station keys: anyone signed in (station iPads tick these all day).
 * - Manager keys: managers and admins.
 * - Everything else: admins only.
 *
 * Founder-managed settings (revenue targets) are refused before this rule is
 * asked — see routes/app-settings.ts.
 */
export type SettingRole = "admin" | "manager" | "viewer";

export const STATION_KEY_PREFIXES = [
  "mozz_load_confirmed_",
  "checklist_done_",
  "station_assignment_",
  "schedule_break_anchors_",
];

export const MANAGER_KEY_PREFIXES = [
  "mac_cheese_extra_packs_",
  "order_email_template",
  // The default flavour order in Create Plan. Managers build the plan every
  // day, so the order they drag must be remembered (issue #420: it was
  // refused for managers while the screen said "Order auto-saved").
  "production_order_recipe_ids",
];

export function isStationSettingKey(key: string): boolean {
  return STATION_KEY_PREFIXES.some(p => key.startsWith(p));
}

export function isManagerSettingKey(key: string): boolean {
  return MANAGER_KEY_PREFIXES.some(p => key.startsWith(p));
}

export function canWriteAppSetting(
  key: string,
  who: { signedIn: boolean; role?: SettingRole | null },
): boolean {
  if (!who.signedIn) return false;
  if (isStationSettingKey(key)) return true;
  if (who.role === "admin") return true;
  if (who.role === "manager" && isManagerSettingKey(key)) return true;
  return false;
}
