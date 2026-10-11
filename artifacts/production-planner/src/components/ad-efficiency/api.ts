/**
 * Data for the At a Glance ROAS cards (Objective I).
 *
 *  - Figures: the Numbers trend series by the day (useSalesTrend) — the
 *    same new-customer revenue, total sales and ad spend as the Order
 *    Analysis tiles and graphs. Nothing new is calculated on the server.
 *  - Targets: GET/PATCH /api/ad-efficiency/settings (routes/ad-efficiency.ts).
 *  - Where each day's spend came from (Meta sync / typed by hand / Google
 *    Ads script): the existing ad-spend range read, so the cards can say
 *    which channels are in.
 *  - The Google Ads script link (founder only): /api/google-ads-link.
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
  /** The day's TOTAL (Meta + Google Ads); null when a channel is missing. */
  amount: number | null;
  /** The Meta channel: 'meta' (synced) or 'manual' (typed on the Numbers panel). */
  source: string | null;
  meta?: number | null;
  google?: number | null;
  missing?: "meta" | "google" | null;
}

export function useSpendSources(from: string, to: string) {
  return useQuery<{ days: SpendSourceDay[]; google?: { firstDate: string | null } }>({
    queryKey: ["ad-efficiency-spend-sources", from, to],
    queryFn: () => request(`/api/founder-focus/ad-spend/range?${new URLSearchParams({ from, to })}`),
    staleTime: 5 * 60_000,
  });
}

// ── Google Ads script link (founder only) ──────────────────────────────────

export interface GoogleAdsLinkStatus {
  hasKey: boolean;
  keyHint: string | null;
  keyCreatedAt: string | null;
  keyCreatedByName: string | null;
  lastReceivedAt: string | null;
  lastDayCount: number | null;
  lastFrom: string | null;
  lastTo: string | null;
  lastAccountId: string | null;
  lastTimeZone: string | null;
  timeZoneWarning: string | null;
  firstDate: string | null;
  daysStored: number;
  ingestPath: string;
  maxDaysPerSend: number;
  script: string;
  placeholders: { url: string; key: string };
}

export const GOOGLE_ADS_LINK_KEY = ["google-ads-link"] as const;

export function useGoogleAdsLink() {
  return useQuery<GoogleAdsLinkStatus>({
    queryKey: GOOGLE_ADS_LINK_KEY,
    queryFn: () => request<GoogleAdsLinkStatus>("/api/google-ads-link"),
    staleTime: 60_000,
  });
}

/** Make a key (replacing any old one). This response is the only time the key is seen. */
export function useMakeGoogleAdsKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request<GoogleAdsLinkStatus & { key: string }>("/api/google-ads-link/key", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: ({ key: _key, ...status }) => qc.setQueryData(GOOGLE_ADS_LINK_KEY, status),
  });
}

/** Turn the link off: the script's next run gets a "wrong key" refusal. */
export function useTurnOffGoogleAds() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request<GoogleAdsLinkStatus>("/api/google-ads-link/key", { method: "DELETE" }),
    onSuccess: (status) => qc.setQueryData(GOOGLE_ADS_LINK_KEY, status),
  });
}
