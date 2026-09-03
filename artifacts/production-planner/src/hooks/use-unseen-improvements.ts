/** How many improvements this person has never opened.
 *
 *  Feeds the count badge on the Improvements nav item — a standing, quiet
 *  nudge to go and look at what the team has been logging, rather than
 *  improvements only being seen by whoever happens to wander in (Graeme,
 *  2026-09-03).
 *
 *  Your own don't count, and everything that existed when this shipped was
 *  marked seen, so the badge starts at zero and only ever counts what is
 *  genuinely new. A badge that opens on "31" is one nobody ever clears.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export const UNSEEN_IMPROVEMENTS_KEY = ["improvements", "unseen-count"];

export function useUnseenImprovementCount(): number {
  const { data } = useQuery({
    queryKey: UNSEEN_IMPROVEMENTS_KEY,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/improvements/unseen-count`, { credentials: "include" });
      if (!res.ok) return { count: 0 };
      return res.json() as Promise<{ count: number }>;
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  return data?.count ?? 0;
}

/** Check one off — called when an improvement is opened and read. */
export function useMarkImprovementSeen() {
  const queryClient = useQueryClient();
  return async (id: number) => {
    try {
      await fetch(`${BASE}/api/improvements/${id}/seen`, { method: "POST", credentials: "include" });
      queryClient.invalidateQueries({ queryKey: UNSEEN_IMPROVEMENTS_KEY });
    } catch {
      // Never let a bookkeeping call get in the way of reading the thing.
    }
  };
}
