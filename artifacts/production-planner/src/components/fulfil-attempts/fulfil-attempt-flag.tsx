/**
 * Shared bits for the "should already have been fulfilled" flow on Order
 * Packing Live (Graeme, 27 Nov 2026 — #140447): whether an opened order is
 * flagged (useFulfilFlag — from the fulfil log or this device's queue), the
 * amber "still sending" banner, and wording shared with the checklist
 * (fulfil-checklist.tsx) and the "Not in Shopify" list. Objective C.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getSnapshot, type QueueEntry } from "@/lib/fulfil-queue";
import { whenWords } from "@/lib/fulfil-flag-words";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface AttemptRow {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  outcome: "started" | "fulfilled" | "refused" | "failed";
  error: string | null;
  userName: string | null;
  consignmentNumber: string | null;
  tryNumber: number | null;
}

export function attemptWords(a: Pick<AttemptRow, "outcome" | "error">): string {
  switch (a.outcome) {
    case "started": return "the server stopped before it finished";
    case "fulfilled": return a.error ? `told the screen it worked (stock: ${a.error})` : "told the screen it worked, but Shopify still shows it open";
    case "refused": return `refused — ${a.error ?? "no reason given"}`;
    case "failed": return `failed — ${a.error ?? "no reason given"}`;
  }
}

/** Re-render every 30 s so "26 minutes ago" stays true. */
export function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

/**
 * Is this order flagged? sending = this device is still sending its
 * Complete; flagged = an earlier try (server log, or this device gave up)
 * yet it's back on the list → the checklist (fulfil-checklist.tsx).
 */
export function useFulfilFlag(orderId: number | null, local?: QueueEntry) {
  const localAt = local?.state === "gave-up" ? local.firstAt : undefined;
  const { data, isLoading } = useQuery<{ attempts: AttemptRow[]; ordersSince: number | null }>({
    queryKey: ["fulfil-attempts", orderId, localAt ?? null],
    queryFn: async () => {
      const q = localAt ? `?localAt=${localAt}` : "";
      const r = await fetch(`${BASE}/api/fulfilment/fulfil-attempts/${orderId}${q}`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    enabled: orderId != null,
    staleTime: 0,
    refetchOnMount: "always",
    retry: 1,
  });
  const sending = !!local && local.state !== "gave-up";
  return { sending, flagged: !sending && ((data?.attempts.length ?? 0) > 0 || local?.state === "gave-up"), loading: isLoading };
}

/**
 * Asked as an order is opened, before any label is looked up or printed:
 * has Complete been pressed for it before (this device's queue, or the
 * server's log)? Any error → false, so a hiccup here never blocks packing.
 */
export async function hasEarlierFulfilAttempt(orderId: number): Promise<boolean> {
  if (getSnapshot().some(e => e.orderId === orderId)) return true;
  try {
    const r = await fetch(`${BASE}/api/fulfilment/fulfil-attempts/${orderId}`, { credentials: "include" });
    if (!r.ok) return false;
    const d = (await r.json()) as { attempts?: unknown[] };
    return (d.attempts?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Amber: this device's Complete is still on its way — leave the order. */
export function StillSendingBanner({ local, onBack }: { local: QueueEntry; onBack: () => void }) {
  const now = useNow();
  return (
    <div className="rounded-xl border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-amber-900 dark:text-amber-100 space-y-2">
      <p className="flex items-start gap-2 text-base">
        <Loader2 className="w-5 h-5 animate-spin flex-shrink-0 mt-0.5" />
        <span>
          <strong>Still sending this order to Shopify</strong> (try {Math.max(1, local.tries)}, Complete pressed {whenWords(local.firstAt, now)}). It's packed — don't pack it again. It clears by itself once the server answers.
          {local.lastError && <span className="block text-sm mt-0.5">Last try: {local.lastError}</span>}
        </span>
      </p>
      <button onClick={onBack} className="px-4 py-2 rounded-xl border-2 border-amber-600 font-bold text-sm">Back to the list</button>
    </div>
  );
}
