/**
 * Raw Meat station marinade ticks — shared between iPads (polled like the
 * tray ticks) and saved straight away with an optimistic tick: the box goes
 * green the moment it's tapped, and if the save fails it goes back and says
 * so (toast). Rules: lib/marinade-ticks.ts. Saved with the Main Prep linked
 * ticks (routes/prep-linked-completions.ts) — same table, draft check and
 * daily-PIN rule. Objective B.
 */
import { useRef } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { afterFailedTick, isDoubleTap, marinadeLineKey, marinadeTicksFrom, ticksByKey, withTick, type MarinadeTick, type MarinadeTickLine } from "@/lib/marinade-ticks";

const keyFor = (planId: number | null) => ["raw-meat-marinade-ticks", planId] as const;

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? `Save failed (${res.status})`;
}

export function useMarinadeTicks(planId: number | null, who: { userId: number | null; userName: string | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const queryKey = keyFor(planId);
  // Ticks still being saved: the poll waits for them, so a slow save is
  // never wiped off the screen by an older answer.
  const saving = useIsMutating({ mutationKey: queryKey });
  const lastTapAt = useRef<number | null>(null);

  const query = useQuery<MarinadeTick[]>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/prep-linked-completions/${planId}`, { credentials: "include" });
      if (!res.ok) throw new Error(await readError(res));
      return marinadeTicksFrom(await res.json());
    },
    enabled: planId != null,
    // Another iPad's ticks show within a few seconds, like the trays.
    refetchInterval: saving > 0 ? false : 5000,
  });

  const mutation = useMutation({
    mutationKey: queryKey,
    // Offline is a failure we say out loud, not a tick that waits unseen.
    networkMode: "always",
    mutationFn: async ({ line, on }: { line: MarinadeTickLine; on: boolean }) => {
      const res = await fetch(`/api/prep-linked-completions/${planId}`, {
        method: on ? "POST" : "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: marinadeLineKey(line) }),
      });
      if (!res.ok) throw new Error(await readError(res));
    },
    onMutate: async ({ line, on }) => {
      await qc.cancelQueries({ queryKey });
      const before = qc.getQueryData<MarinadeTick[]>(queryKey) ?? [];
      const key = marinadeLineKey(line);
      const was = ticksByKey(before).get(key) ?? null;
      qc.setQueryData<MarinadeTick[]>(queryKey, withTick(before, key, on, { ...who, tickedAt: new Date().toISOString() }));
      return { was };
    },
    onError: (e: Error, { line, on }, ctx) => {
      // Only this line goes back — other ticks made meanwhile stay put.
      qc.setQueryData<MarinadeTick[]>(queryKey, cur => afterFailedTick(cur ?? [], marinadeLineKey(line), ctx?.was ?? null));
      toast({ title: on ? "Tick not saved" : "Untick not saved", description: e.message, variant: "destructive" });
    },
    // Re-read once the last tick in hand has landed.
    onSettled: () => { if (qc.isMutating({ mutationKey: queryKey }) <= 1) void qc.invalidateQueries({ queryKey }); },
  });

  return {
    ticked: ticksByKey(query.data ?? []),
    /** The saved ticks have arrived. Until then the boxes wait: a line that
     *  has gone in must never read as if it hasn't. */
    ready: query.data !== undefined,
    /** Couldn't load them (it keeps trying). */
    failed: query.isError && query.data === undefined,
    setTick: (line: MarinadeTickLine, on: boolean) => {
      const now = Date.now();
      if (isDoubleTap(lastTapAt.current, now)) return;
      lastTapAt.current = now;
      mutation.mutate({ line, on });
    },
  };
}
