import { useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

/** { [ingredientId]: people (other than me) looking at that item right now } */
export type PrepPresenceData = Record<number, { userId: number; userName: string }[]>;

/** Everyone else currently viewing this item on the plan (server already
 *  leaves the viewer out). */
export function othersViewing(
  presence: PrepPresenceData | null | undefined,
  ingredientId: number | null | undefined,
): { userId: number; userName: string }[] {
  if (!presence || ingredientId == null) return [];
  return presence[ingredientId] ?? [];
}

/** "Jane also viewing this" / "Jane, Kyra also viewing this" — null when
 *  nobody else is looking, so the marker isn't drawn. */
export function alsoViewingNames(
  presence: PrepPresenceData | null | undefined,
  ingredientId: number | null | undefined,
): string | null {
  const people = othersViewing(presence, ingredientId);
  if (people.length === 0) return null;
  return people.map(p => p.userName).join(", ");
}

/**
 * Prep-room "also viewing" presence, shared by Main Prep and Bases & Sauces
 * (Fix queue #64). Polls who is looking at what every 10s, sends a 15s
 * heartbeat with the item I have open, and clears mine on leaving. The
 * presence store is ephemeral and in-memory on the server; nothing is saved.
 */
export function usePrepPresence(planId: number) {
  const activeIngIdRef = useRef<number | null>(null);

  const { data: presenceData = {} } = useQuery<PrepPresenceData>({
    queryKey: ["prep-presence", planId],
    queryFn: async () => {
      const r = await fetch(`/api/production-plans/${planId}/prep-presence`, { credentials: "include" });
      if (!r.ok) throw new Error(`Presence failed (${r.status})`);
      return (await r.json()) as PrepPresenceData;
    },
    refetchInterval: 10_000,
  });

  const postPresence = useCallback((ingredientId: number | null) => {
    fetch(`/api/production-plans/${planId}/prep-presence`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingredientId }),
    }).catch((err) => { console.warn("[PrepPresence] Presence post failed:", err); });
  }, [planId]);

  /** Mark this item as the one I'm looking at (null = nothing). */
  const setViewing = useCallback((ingredientId: number | null) => {
    activeIngIdRef.current = ingredientId;
    postPresence(ingredientId);
  }, [postPresence]);

  // Heartbeat every 15s; clear my presence when leaving the screen/plan.
  useEffect(() => {
    const hb = setInterval(() => postPresence(activeIngIdRef.current), 15_000);
    return () => { clearInterval(hb); postPresence(null); };
  }, [postPresence]);

  return { presenceData, setViewing };
}
