/**
 * Short-delivery report settings (Graeme, 2026-10-15): which team list gets
 * the reports and who always gets a to-do + bell. Server:
 * routes/short-delivery-reports.ts; the reports themselves are made at
 * goods-in (lib/short-delivery-report.ts).
 */
import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface ShortReportSettings {
  teamListId: number | null;
  teamListName: string | null;
  recipientIds: number[];
  teamLists: Array<{ id: number; name: string }>;
}

export const SHORT_REPORT_SETTINGS_KEY = ["/api/deliveries/short-reports/settings"] as const;

export function useShortReportSettings(enabled = true) {
  return useQuery<ShortReportSettings>({
    queryKey: SHORT_REPORT_SETTINGS_KEY,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/deliveries/short-reports/settings`, { credentials: "include" });
      if (!res.ok) throw new Error("Couldn't load the short-delivery settings");
      return res.json();
    },
    enabled,
    staleTime: 60_000,
  });
}

export async function saveShortReportSettings(v: { teamListId: number | null; recipientIds: number[] }): Promise<ShortReportSettings> {
  const res = await fetch(`${BASE}/api/deliveries/short-reports/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(v),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || "Couldn't save");
  return body as ShortReportSettings;
}

/** What POST /deliveries/:id/receive says about the report it made. */
export type ShortReportOutcome =
  | {
      action: "none" | "created" | "same" | "updated" | "resolved";
      shortCount: number;
      teamList: { id: number; name: string } | null;
      told: Array<{ id: number; name: string }>;
      warning?: string;
    }
  | { error: string }
  | null;
