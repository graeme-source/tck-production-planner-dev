import { useEffect, useState } from "react";

/**
 * Reads the two app_settings rows that drive the building-station
 * countdown timer:
 *
 *   building_timer_enabled          "true" | "false"
 *   building_timer_default_seconds  number of seconds (default 480 = 8 minutes)
 *
 * Both are exposed via the generic GET /api/app-settings/:key
 * endpoint. While the initial fetch is in flight `enabled` is `null`,
 * which the caller should treat as "feature off" so the existing
 * button layout renders without flicker.
 */
export interface BuildTimerConfig {
  enabled: boolean | null;
  defaultSeconds: number;
}

const FALLBACK_DEFAULT_SECONDS = 480; // 8 minutes

export function useBuildTimerConfig(): BuildTimerConfig {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [defaultSeconds, setDefaultSeconds] = useState<number>(FALLBACK_DEFAULT_SECONDS);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/app-settings/building_timer_enabled", { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null),
      fetch("/api/app-settings/building_timer_default_seconds", { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null),
    ]).then(([e, d]) => {
      if (cancelled) return;
      setEnabled(e?.value === "true");
      if (d?.value) {
        const parsed = Number(d.value);
        if (Number.isFinite(parsed) && parsed > 0) setDefaultSeconds(parsed);
      }
    });
    return () => { cancelled = true; };
  }, []);

  return { enabled, defaultSeconds };
}
