/**
 * The slow-meat tray limit's inputs (GET /api/slow-meat/profile): the limit,
 * the cook-time threshold, and each slow-meat recipe's kg per batch on the
 * Raw Meat station's trays. The Create Plan screen counts trays live from it.
 */
import { useQuery } from "@tanstack/react-query";
import type { SlowMeatProfileData } from "@/lib/slow-meat-plan";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const SLOW_MEAT_PROFILE_KEY = ["slow-meat-profile"] as const;

export function useSlowMeatProfile(enabled: boolean) {
  return useQuery<SlowMeatProfileData>({
    queryKey: SLOW_MEAT_PROFILE_KEY,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/slow-meat/profile`, { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't load the slow-meat limit (${res.status})`);
      return res.json();
    },
    enabled,
    // Recipes and tray sizes change rarely; refresh each time the dialog opens.
    refetchOnMount: "always",
  });
}

export async function saveSlowMeatSettings(body: { minCookMinutes: number; trayLimit: number }): Promise<void> {
  const res = await fetch(`${BASE}/api/slow-meat/settings`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b?.error ?? `Couldn't save (${res.status})`);
  }
}
