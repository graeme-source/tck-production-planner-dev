/**
 * One-off walkthroughs the signed-in person has finished (/api/user-tours,
 * Objective H). Per person, so it follows them from iPad to iPad; the key
 * includes the user id so a PIN switch on a shared iPad reads afresh.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function useCompletedTours(userId: number | null, enabled = true) {
  return useQuery({
    queryKey: ["user-tours", userId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/user-tours/me`, { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't load walkthroughs (${res.status})`);
      return ((await res.json()) as { completed: string[] }).completed;
    },
    enabled: enabled && userId != null,
    staleTime: Infinity,
    retry: 1,
  });
}

export function useCompleteTour(userId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) => {
      const res = await fetch(`${BASE}/api/user-tours/me/${encodeURIComponent(key)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: true }),
      });
      if (!res.ok) throw new Error(`Couldn't save (${res.status})`);
    },
    onSuccess: (_d, key) => {
      qc.setQueryData<string[]>(["user-tours", userId], prev => [...new Set([...(prev ?? []), key])]);
    },
  });
}
