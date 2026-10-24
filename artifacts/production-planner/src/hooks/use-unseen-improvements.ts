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
import { needsReview, type ReviewableImprovement } from "@/lib/improvement-review";

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

/** The feed list's cache key (pages/improvements.tsx). */
const IMPROVEMENTS_LIST_KEY = ["improvements"];

/** Check one off — scrolled past, "I've seen this", or opened.
 *
 *  The nav badge drops AT ONCE (Graeme, 24 Oct: scrolling past should take
 *  it off the number in the left-hand navigation): if the feed's copy says
 *  this one is counted, the cached count goes down by one and the card is
 *  marked seen, then the server confirms and both are refetched. */
export function useMarkImprovementSeen() {
  const queryClient = useQueryClient();
  return async (id: number) => {
    const list = queryClient.getQueryData<Array<ReviewableImprovement & { id: number }>>(IMPROVEMENTS_LIST_KEY);
    const item = Array.isArray(list) ? list.find(i => i.id === id) : undefined;
    if (item && needsReview(item)) {
      // Stop an in-flight refetch landing the old number on top of ours.
      await queryClient.cancelQueries({ queryKey: UNSEEN_IMPROVEMENTS_KEY, exact: true });
      queryClient.setQueryData<{ count: number }>(UNSEEN_IMPROVEMENTS_KEY, old =>
        old ? { count: Math.max(0, old.count - 1) } : old);
      queryClient.setQueryData<Array<ReviewableImprovement & { id: number }>>(IMPROVEMENTS_LIST_KEY, old =>
        old?.map(i => (i.id === id ? { ...i, seenByMe: true } : i)));
    }
    try {
      await fetch(`${BASE}/api/improvements/${id}/seen`, { method: "POST", credentials: "include" });
    } catch {
      // Never let a bookkeeping call get in the way of reading the thing;
      // the refetch below puts the true count back.
    }
    queryClient.invalidateQueries({ queryKey: UNSEEN_IMPROVEMENTS_KEY, exact: true });
    queryClient.invalidateQueries({ queryKey: IMPROVEMENTS_LIST_KEY, exact: true });
  };
}
