import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export interface IcePacksToday {
  enabled: boolean;
  forecastSource?: "live" | "cached" | "fallback";
  highTemp: number | null;
  highTempRaw?: number;
  smallBoxPacks?: number;
  largeBoxPacks?: number;
  location?: { name: string; latitude: number; longitude: number };
  days?: Array<{ date: string; maxTemp: number }>;
  asOf?: string | null;
  message?: string;
}

async function fetchIcePacks(): Promise<IcePacksToday> {
  const res = await fetch(`${BASE}/api/ice-packs/today`, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load ice-pack rule: ${res.status}`);
  return res.json();
}

/** Today's despatch ice-pack instruction (weather-driven). Refreshes hourly. */
export function useIcePacks() {
  return useQuery({
    queryKey: ["ice-packs", "today"],
    queryFn: fetchIcePacks,
    refetchInterval: 60 * 60 * 1000, // hourly — the forecast barely moves intraday
    refetchOnWindowFocus: false,
    staleTime: 30 * 60 * 1000,
  });
}
