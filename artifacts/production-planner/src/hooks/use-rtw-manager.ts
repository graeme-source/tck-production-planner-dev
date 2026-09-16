import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Is the signed-in person one of the named RTW managers (Graeme and Lorna)?
 * The server decides (middleware/rtw-access.ts — roles do NOT qualify); this
 * just surfaces its flag so the sidebar and the People page can follow it.
 * Cached: it changes roughly never.
 */
export function useIsRtwManager(): boolean {
  const { state } = useAuth();
  const { data } = useQuery<{ isRtwManager: boolean }>({
    queryKey: ["rtw-manager-flag"],
    enabled: state.status === "authenticated",
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/return-to-work/mine`, { credentials: "include" });
      if (!r.ok) return { isRtwManager: false };
      return r.json();
    },
  });
  return data?.isRtwManager === true;
}
