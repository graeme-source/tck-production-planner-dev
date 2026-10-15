/**
 * The factory-number forecast for a plan date (GET /api/factory-forecast):
 * predicted late orders per despatch, recipe sales shares, emails due and
 * the thresholds. The screen combines it with its live rows, so editing a
 * batch updates the card without a refetch. Until it loads (or if it can't),
 * the card shows known orders only and says so.
 */
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_FACTORY_THRESHOLDS, type FactoryThresholds, type LateTotal } from "@workspace/stock-prediction";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface DespatchLateForecast {
  despatchDate: string;
  deliveryDate: string;
  cutoffAt: string;
  hoursToCutoff: number;
  closed: boolean;
  latePacks: number;
  low: number;
  high: number;
  shareStillToCome: number;
  typicalDayPacks: number;
  samples: number;
  emailsInWindow: number;
  typicalEmails: number;
  emailAdjustment: number;
}

export interface FactoryForecastResponse {
  planDate: string;
  generatedAt: string;
  despatches: DespatchLateForecast[];
  total: LateTotal;
  lastCutoffAt: string;
  emails: Array<{ at: string; name: string; source: "klaviyo" | "plan" }>;
  klaviyoConnected: boolean;
  recipeShares: Record<string, number>;
  thresholds: FactoryThresholds;
}

export const factoryForecastKey = (planDate: string) => ["factory-forecast", planDate] as const;

export function useFactoryForecast(planDate: string | null | undefined, enabled = true) {
  const q = useQuery<FactoryForecastResponse>({
    queryKey: factoryForecastKey(planDate ?? ""),
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/factory-forecast?planDate=${encodeURIComponent(planDate!)}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't load the factory forecast (${res.status})`);
      return res.json();
    },
    enabled: enabled && !!planDate && /^\d{4}-\d{2}-\d{2}$/.test(planDate),
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
  });
  return {
    data: q.data ?? null,
    thresholds: q.data?.thresholds ?? DEFAULT_FACTORY_THRESHOLDS,
    late: q.data?.total ?? { latePacks: 0, low: 0, high: 0 },
    loading: q.isLoading,
    loadError: q.isError,
  };
}

export async function saveFactoryThresholds(body: FactoryThresholds): Promise<FactoryThresholds> {
  const res = await fetch(`${BASE}/api/factory-forecast/settings`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(b?.details?.formErrors?.[0] ?? b?.error ?? `Couldn't save (${res.status})`);
  return b.thresholds as FactoryThresholds;
}
