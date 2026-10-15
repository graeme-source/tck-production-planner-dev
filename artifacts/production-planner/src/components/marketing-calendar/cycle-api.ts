/**
 * The email plan's data (server: api-server/src/routes/marketing-email-cycle.ts).
 * React Query throughout; re-read on focus and every minute so two people
 * planning see each other's changes.
 */
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { CycleOffer, CyclePause, KeyDate, OfferEmailType, PlanDayType } from "@workspace/marketing-calendar";
import { CAL_KEY, calApi } from "./api";

export const CYCLE_KEY = [...CAL_KEY, "cycle"] as const;

export interface CycleResponse {
  config: {
    startDate: string;
    weeklyPlan: Array<PlanDayType | null>;
    offers: Array<CycleOffer & { position: number }>;
    pauses: CyclePause[];
    freeIdeas: Array<{ idea: string; subject: string }>;
  };
  keyDates: KeyDate[];
  configured: boolean;
  canEditSetup: boolean;
  settings: { updatedBy: string | null; updatedAt: string } | null;
  /** Monday → product added that week. */
  products: Record<string, string>;
}

export function useCycle() {
  return useQuery({
    queryKey: [...CYCLE_KEY, "config"],
    queryFn: () => calApi<CycleResponse>("/marketing-calendar/cycle"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: prev => prev,
  });
}

export interface KlaviyoResult { campaignId: string; recipients: number; openRate: number; clickRate: number; orders: number; revenue: number }

/** Results per sent email — the server shares one Klaviyo report for 30 min. */
export function useKlaviyoResults(enabled = true) {
  return useQuery({
    enabled,
    queryKey: [...CYCLE_KEY, "results"],
    queryFn: () => calApi<{ connected: boolean; results: KlaviyoResult[]; updatedAt: string | null; error?: string }>("/marketing-calendar/cycle/results"),
    refetchInterval: 10 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: prev => prev,
  });
}

export function invalidateCycle(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: CYCLE_KEY });
}

/** The stored planned email for a cycle slot (made now if needed). */
export async function ensureSlot(date: string): Promise<number> {
  const r = await calApi<{ emailId: number; created: boolean }>(`/marketing-calendar/cycle/slots/${date}`, { method: "POST", body: "{}" });
  return r.emailId;
}

/** Delete an email from a day; `slot` = the day's cycle email goes too and stays gone. */
export function removeDayEmail(date: string, body: { emailId: number | null; slot: boolean }) {
  return calApi<{ removed: number }>(`/marketing-calendar/cycle/days/${date}/remove`, { method: "POST", body: JSON.stringify(body) });
}

export function setWeekProduct(monday: string, product: string | null) {
  return calApi<{ weekStart: string; product: string | null }>(`/marketing-calendar/cycle/weeks/${monday}`, {
    method: "PUT", body: JSON.stringify({ product }),
  });
}

// ── Calendar setup (founder) ─────────────────────────────────────────────
export function saveSettings(body: { startDate?: string; weeklyPlan?: Array<PlanDayType | null>; freeSlotIdeas?: Array<{ idea: string; subject: string }> }) {
  return calApi<{ ok: true }>("/marketing-calendar/cycle/settings", { method: "PUT", body: JSON.stringify(body) });
}

export interface OfferPatch {
  code?: string; name?: string; tag?: string | null; colour?: string; featuresProduct?: boolean;
  subjects?: Partial<Record<OfferEmailType, string | null>>; position?: number;
}
export const createOffer = (b: OfferPatch & { code: string; name: string }) =>
  calApi<{ offer: CycleOffer }>("/marketing-calendar/cycle/offers", { method: "POST", body: JSON.stringify(b) });
export const patchOffer = (id: number, b: OfferPatch) =>
  calApi<{ offer: CycleOffer }>(`/marketing-calendar/cycle/offers/${id}`, { method: "PATCH", body: JSON.stringify(b) });
export const deleteOffer = (id: number) => calApi<{ ok: true }>(`/marketing-calendar/cycle/offers/${id}`, { method: "DELETE" });

export const createKeyDate = (b: { date: string; name: string; big?: boolean }) =>
  calApi<{ keyDate: KeyDate }>("/marketing-calendar/cycle/key-dates", { method: "POST", body: JSON.stringify(b) });
export const patchKeyDate = (id: number, b: Partial<{ date: string; name: string; big: boolean }>) =>
  calApi<{ keyDate: KeyDate }>(`/marketing-calendar/cycle/key-dates/${id}`, { method: "PATCH", body: JSON.stringify(b) });
export const deleteKeyDate = (id: number) => calApi<{ ok: true }>(`/marketing-calendar/cycle/key-dates/${id}`, { method: "DELETE" });

export const createPause = (b: { name: string; startDate: string; endDate: string }) =>
  calApi<{ pause: CyclePause }>("/marketing-calendar/cycle/pauses", { method: "POST", body: JSON.stringify(b) });
export const patchPause = (id: number, b: Partial<{ name: string; startDate: string; endDate: string }>) =>
  calApi<{ pause: CyclePause }>(`/marketing-calendar/cycle/pauses/${id}`, { method: "PATCH", body: JSON.stringify(b) });
export const deletePause = (id: number) => calApi<{ ok: true }>(`/marketing-calendar/cycle/pauses/${id}`, { method: "DELETE" });

export function useInvalidateCycle() {
  const qc = useQueryClient();
  return () => invalidateCycle(qc);
}
