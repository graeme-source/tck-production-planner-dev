/** The stored production KPIs (Analytics → Production KPIs), with the old
 *  figures as a fallback while they load or if the read fails. */
import { useQuery } from "@tanstack/react-query";
import { resolveKpis, type ProductionKpi, type ProductionKpiKey } from "@/lib/production-kpis";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
export const PRODUCTION_KPIS_KEY = ["production-kpis"] as const;

export interface ProductionKpisResponse {
  kpis: Partial<Record<ProductionKpiKey, ProductionKpi & { updatedAt?: string | null }>>;
  canEdit: boolean;
}

export function useProductionKpis() {
  const q = useQuery<ProductionKpisResponse>({
    queryKey: PRODUCTION_KPIS_KEY,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/production-kpis`, { credentials: "include" });
      if (!res.ok) throw new Error("Couldn't load the production KPIs");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });
  return { ...q, kpis: resolveKpis(q.data?.kpis) };
}
