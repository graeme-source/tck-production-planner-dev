/**
 * Defects — React Query hooks for /api/defects (Objective E). Every query
 * key starts with "defects" so one invalidation after a save refreshes the
 * KPI cards, the breakdowns and the history together.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DefectRecord, DefectSummary, DefectType } from "@/lib/defects-view";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** A named period (worked out on the server in London time) or a date range. */
export type DefectRange = { period: "today" | "week" | "month" } | { from: string; to: string };

function rangeQuery(r: DefectRange): string {
  return "period" in r ? `period=${r.period}` : `from=${r.from}&to=${r.to}`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api/defects${path}`, {
    credentials: "include",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...(init.headers ?? {}) } : init?.headers,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Something went wrong (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function useDefectTypes(enabled = true) {
  return useQuery({
    queryKey: ["defects", "types"],
    queryFn: () => api<{ types: DefectType[] }>("/types").then(r => r.types),
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useDefectRecipeOptions(enabled = true) {
  return useQuery({
    queryKey: ["defects", "recipe-options"],
    queryFn: () => api<{ recipes: Array<{ id: number; name: string; category: string | null }> }>("/options").then(r => r.recipes),
    staleTime: 10 * 60_000,
    enabled,
  });
}

export function useDefectSummary(range: DefectRange, enabled = true) {
  const q = rangeQuery(range);
  return useQuery({
    queryKey: ["defects", "summary", q],
    queryFn: () => api<DefectSummary>(`/summary?${q}`),
    staleTime: 60_000,
    enabled,
  });
}

export function useDefectList(range: DefectRange, enabled = true) {
  const q = rangeQuery(range);
  return useQuery({
    queryKey: ["defects", "list", q],
    queryFn: () => api<{ defects: DefectRecord[] }>(`/?${q}`).then(r => r.defects),
    staleTime: 60_000,
    enabled,
  });
}

export interface DefectInput {
  occurredOn: string;
  defectTypeId: number;
  recipeId: number | null;
  packs: number;
  station: string | null;
  orderRefs: string | null;
  note: string | null;
}

export function useSaveDefect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number | null; input: DefectInput }) =>
      id == null
        ? api<{ defect: { id: number } }>("/", { method: "POST", body: JSON.stringify(input) })
        : api<{ defect: { id: number } }>(`/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["defects"] }),
  });
}

export function useDeleteDefect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<{ ok: true }>(`/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["defects"] }),
  });
}

export function useSaveDefectType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number | null; patch: Partial<Pick<DefectType, "name" | "active" | "sortOrder">> }) =>
      id == null
        ? api<{ type: DefectType }>("/types", { method: "POST", body: JSON.stringify(patch) })
        : api<{ type: DefectType }>(`/types/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["defects"] }),
  });
}
