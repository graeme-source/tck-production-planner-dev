/**
 * Data for the At a Glance ROAS cards (Objective I).
 *
 *  - Figures: the Numbers trend series by the day (useSalesTrend) — the
 *    same new-customer revenue, total sales and ad spend as the Order
 *    Analysis tiles and graphs. Nothing new is calculated on the server.
 *  - Targets: GET/PATCH /api/ad-efficiency/settings (routes/ad-efficiency.ts).
 *  - Where each day's spend came from (Meta sync / typed by hand): the
 *    existing ad-spend range read, so the cards can say which channels are in.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdEfficiencySettings } from "@/lib/ad-efficiency";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface AdEfficiencySettingsPayload {
  settings: AdEfficiencySettings;
  updatedAt: string;
  updatedByName: string | null;
  /** The founder only — the server refuses anyone else's changes anyway. */
  canEdit: boolean;
}

export const AD_EFFICIENCY_SETTINGS_KEY = ["ad-efficiency-settings"] as const;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export function useAdEfficiencySettings() {
  return useQuery<AdEfficiencySettingsPayload>({
    queryKey: AD_EFFICIENCY_SETTINGS_KEY,
    queryFn: () => request<AdEfficiencySettingsPayload>("/api/ad-efficiency/settings"),
    staleTime: 5 * 60_000,
  });
}

/** Change one or more settings; the cards re-colour from the saved row. */
export function useSaveAdEfficiencySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<AdEfficiencySettings>) =>
      request<AdEfficiencySettingsPayload>("/api/ad-efficiency/settings", { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: (data) => qc.setQueryData(AD_EFFICIENCY_SETTINGS_KEY, data),
  });
}

export interface SpendSourceDay {
  date: string;
  amount: number | null;
  /** 'meta' (synced) or 'manual' (typed on the Numbers panel). */
  source: string | null;
}

export function useSpendSources(from: string, to: string) {
  return useQuery<{ days: SpendSourceDay[] }>({
    queryKey: ["ad-efficiency-spend-sources", from, to],
    queryFn: () => request(`/api/founder-focus/ad-spend/range?${new URLSearchParams({ from, to })}`),
    staleTime: 5 * 60_000,
  });
}
