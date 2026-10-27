/**
 * The live, adapting day schedule (GET /api/production-plans/:id/live-schedule,
 * Graeme 2026-10-27): every recipe's "builders reach it at" and every meat's
 * "in the oven by", re-planned from batches built and today's pace, plus each
 * meat's trust signal from the daily review. Refreshes every minute so the
 * times keep moving with the builders.
 *
 * Also the station side of the daily review: off-time put-ins waiting for a
 * "why?", and saving a quick-pick reason.
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { LiveSchedule, TrustSignal } from "@workspace/production-schedule";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface LiveScheduleData extends LiveSchedule {
  planId: number;
  planDate: string;
  isToday: boolean;
  maxHoldMinutes: number;
  /** Keyed by raw-meat ingredient id. */
  trust: Record<number, TrustSignal>;
}

export const liveScheduleKey = (planId: number) => ["live-schedule", planId] as const;

export function useLiveSchedule(planId: number | null | undefined) {
  return useQuery<LiveScheduleData>({
    queryKey: liveScheduleKey(planId ?? 0),
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/production-plans/${planId}/live-schedule`, { credentials: "include" });
      if (!res.ok) throw new Error(`Live schedule failed (${res.status})`);
      return res.json();
    },
    enabled: !!planId,
    refetchInterval: 60_000,
  });
}

export interface PutInReason { code: string; label: string; category: string }

export interface PendingPutIn {
  recordId: number;
  recipeName: string;
  ingredientName: string;
  suggestedAtMinutes: number | null;
  putInMinutes: number;
  deviationMinutes: number | null;
}

/** Returned by POST /oven-events/oven-in on a meat's first tray. */
export interface PutInSnapshot extends PendingPutIn {
  needsReason: boolean;
}

export const pendingReasonsKey = (planId: number) => ["meat-put-in-pending", planId] as const;

export function usePendingPutInReasons(planId: number | null | undefined) {
  return useQuery<{ pending: PendingPutIn[]; reasons: PutInReason[] }>({
    queryKey: pendingReasonsKey(planId ?? 0),
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/meat-timing/pending-reasons?planId=${planId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't load reasons (${res.status})`);
      return res.json();
    },
    enabled: !!planId,
  });
}

export function useSavePutInReason(planId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (b: { recordId: number; code: string; note?: string }) => {
      const res = await fetch(`${BASE}/api/meat-timing/put-ins/${b.recordId}/reason`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: b.code, ...(b.note ? { note: b.note } : {}) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Couldn't save (${res.status})`);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: pendingReasonsKey(planId) }),
  });
}

const LONDON_HM = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function londonMinuteNow(): number {
  const [h, m] = LONDON_HM.format(new Date()).split(":");
  return Number(h) * 60 + Number(m);
}

/** Minutes since London midnight, ticking — drives the "in 12 min" countdown. */
export function useLondonMinute(): number {
  const [minute, setMinute] = useState(londonMinuteNow);
  useEffect(() => {
    const id = setInterval(() => setMinute(londonMinuteNow()), 15_000);
    return () => clearInterval(id);
  }, []);
  return minute;
}
