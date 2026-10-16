/**
 * Sales drivers API hooks (server: api-server routes/sales-drivers.ts).
 * Objective I.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api/sales-drivers${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const CHANGE_CATEGORIES = [
  { value: "offer", label: "Offer" },
  { value: "price", label: "Price" },
  { value: "delivery", label: "Delivery" },
  { value: "theme", label: "Website" },
  { value: "email", label: "Email" },
  { value: "ads", label: "Ads" },
  { value: "ab_test", label: "A/B test" },
  { value: "external", label: "Outside world" },
  { value: "other", label: "Other" },
] as const;
export type ChangeCategory = (typeof CHANGE_CATEGORIES)[number]["value"];

export interface DailyRow {
  day: string;
  sessions: number | null;
  conversionRate: number | null;
  orders: number | null;
  newCustomerOrders: number | null;
  revenue: number | null;
  leadDays: number | null;
  nextDayAvailable: boolean | null;
  leadSource: string | null;
  sampleOrders: number | null;
}

export interface Comparison {
  effect: number | null;
  low: number | null;
  high: number | null;
  probabilityLower: number | null;
  exposedDays: number;
  comparisonDays: number;
  enoughData: boolean;
}

export interface Change {
  id: number;
  effectiveAt: string;
  category: string;
  title: string;
  detail: string | null;
  source: string;
  impact: (Comparison & { leadShift: number | null; likelihood: string }) | null;
}

export interface Overview {
  from: string;
  to: string;
  series: DailyRow[];
  findings: {
    lead: Array<{ label: string; extraDays: number; comparison: Comparison; sentence: string }>;
    weekday: Array<{ weekday: string; days: number; conversion: number | null; usualLead: number | null }>;
    weekendNote: string | null;
    daysAnalysed: number;
    exactLeadDays: number;
    estimatedLeadDays: number;
  };
  changes: Change[];
  latestCheck: { day: string; checked_at: string; earliest_date: string | null; lead_days: number | null; next_day_available: boolean | null; source: string } | null;
}

const OVERVIEW_KEY = ["sales-drivers", "overview"];

export function useSalesDrivers(days = 120) {
  return useQuery<Overview>({ queryKey: [...OVERVIEW_KEY, days], queryFn: () => api(`/overview?days=${days}`), staleTime: 5 * 60_000 });
}

export function useSpendContext(from: string, to: string, enabled = true) {
  return useQuery<{ notes: string[] }>({
    queryKey: ["sales-drivers", "context", from, to],
    queryFn: () => api(`/context?from=${from}&to=${to}`),
    enabled,
    staleTime: 10 * 60_000,
  });
}

export function useAddChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { effectiveAt: string; category: ChangeCategory; title: string; detail?: string | null }) =>
      api<{ id: number }>("/changes", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sales-drivers"] }),
  });
}

export function useDeleteChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<{ ok: true }>(`/changes/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sales-drivers"] }),
  });
}

export function useRefreshDrivers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ refresh: { ok: boolean; steps: Record<string, string> } }>("/refresh", { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sales-drivers"] }),
  });
}

export const exportUrl = () => `${BASE}/api/sales-drivers/export`;
