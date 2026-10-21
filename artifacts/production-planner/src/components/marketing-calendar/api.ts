/**
 * Marketing calendar data (Graeme, 2026-10-20: phases + Klaviyo emails).
 * Server: api-server/src/routes/marketing-calendar.ts (phases + emails),
 * marketing-offers.ts (offer library), marketing-approvals.ts (approve).
 * React Query throughout. The calendar refetches every 25 s and whenever
 * the window regains focus, so two people planning at once see each
 * other's changes without reloading.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface Person { id: number | null; name: string }

export interface Phase {
  id: number;
  title: string;
  startDate: string;
  endDate: string;
  offers: string[];
  customerGroup: string;
  /** Palette key or "#rrggbb" (@workspace/marketing-calendar phase-colours); null = the calendar's default colour. */
  color: string | null;
  notes: string | null;
  source: string;
  /** Set on a test box's own phase: its dates follow the box. */
  testBoxId: number | null;
  createdBy: Person | null;
  updatedBy: Person | null;
  createdAt: string;
  updatedAt: string;
}

export interface HistoryEntry {
  id: number;
  userId: number | null;
  userName: string | null;
  action: string;
  summary: string;
  at: string;
}

export interface Suggestion {
  name: string;
  startDate: string;
  endDate: string;
  angle: string;
  offerIdea: string;
}

export async function calApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string; details?: { formErrors?: string[]; fieldErrors?: Record<string, string[]> } };
    const field = err.details?.fieldErrors ? Object.values(err.details.fieldErrors).flat()[0] : undefined;
    throw new Error(err.details?.formErrors?.[0] ?? field ?? err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const CAL_KEY = ["marketing-calendar"] as const;
const POLL_MS = 25_000;

// ── Phases ─────────────────────────────────────────────────────────────────
export function usePhases(from: string, to: string) {
  return useQuery({
    queryKey: [...CAL_KEY, "range", from, to],
    queryFn: () => calApi<{ today: string; events: Phase[] }>(`/marketing-calendar/events?from=${from}&to=${to}`),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    placeholderData: prev => prev,
  });
}

export function usePhase(id: number | null) {
  return useQuery({
    queryKey: [...CAL_KEY, "event", id],
    queryFn: () => calApi<{ event: Phase; deleted: boolean; deletedBy: string | null; history: HistoryEntry[] }>(`/marketing-calendar/events/${id}`),
    enabled: id != null,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
}

/** Every phase ever, newest first — "Re-use a past phase" searches these. */
export function useAllPhases(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: [...CAL_KEY, "all-phases"],
    queryFn: () => calApi<{ phases: Phase[] }>("/marketing-calendar/phases/all"),
  });
}

/** Put a changed phase straight into every cached range so the grid updates before the next poll. */
export function patchCachedPhase(qc: QueryClient, phase: Phase) {
  qc.setQueriesData<{ today: string; events: Phase[] }>({ queryKey: [...CAL_KEY, "range"] }, old =>
    old ? { ...old, events: old.events.map(e => (e.id === phase.id ? phase : e)) } : old);
}

export function invalidateCalendar(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: CAL_KEY });
}

export interface NewPhase {
  title: string;
  startDate: string;
  endDate: string;
  offers?: string[];
  customerGroup?: string;
  color?: string | null;
  notes?: string | null;
  source?: "manual" | "ai" | "reuse";
  copiedFromId?: number;
}

export function createPhase(body: NewPhase) {
  return calApi<{ event: Phase }>("/marketing-calendar/events", { method: "POST", body: JSON.stringify(body) });
}

export function useCreatePhase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPhase,
    onSuccess: () => { void invalidateCalendar(qc); },
  });
}

export function patchPhase(id: number, patch: Record<string, unknown>) {
  return calApi<{ event: Phase }>(`/marketing-calendar/events/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function putPhaseDates(id: number, d: { startDate: string; endDate: string }) {
  return calApi<{ event: Phase }>(`/marketing-calendar/events/${id}/dates`, { method: "PUT", body: JSON.stringify(d) });
}

/** Drag on the grid — optimistic: the bar stays where it was dropped while the save runs. */
export function useSetPhaseDates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, startDate, endDate }: { id: number; startDate: string; endDate: string }) => putPhaseDates(id, { startDate, endDate }),
    onMutate: ({ id, startDate, endDate }) => {
      qc.setQueriesData<{ today: string; events: Phase[] }>({ queryKey: [...CAL_KEY, "range"] }, old =>
        old ? { ...old, events: old.events.map(e => (e.id === id ? { ...e, startDate, endDate } : e)) } : old);
    },
    onSettled: () => { void invalidateCalendar(qc); },
  });
}

export function deletePhase(id: number) {
  return calApi<{ ok: true }>(`/marketing-calendar/events/${id}`, { method: "DELETE" });
}
export function restorePhase(id: number) {
  return calApi<{ event: Phase }>(`/marketing-calendar/events/${id}/restore`, { method: "POST", body: "{}" });
}

// ── Calendar settings: the default phase colour (2026-10-21) ───────────────
export interface CalendarSettings {
  /** Palette key or "#rrggbb" — phases with no colour of their own use it. */
  defaultPhaseColour: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

const SETTINGS_KEY = [...CAL_KEY, "settings"] as const;

export function useCalendarSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => calApi<CalendarSettings>("/marketing-calendar/settings"),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function putCalendarSettings(body: { defaultPhaseColour: string | null }) {
  return calApi<CalendarSettings>("/marketing-calendar/settings", { method: "PUT", body: JSON.stringify(body) });
}

export function setCachedSettings(qc: QueryClient, s: CalendarSettings) {
  qc.setQueryData(SETTINGS_KEY, s);
}

// ── Offer library ──────────────────────────────────────────────────────────
export interface Offer {
  id: number;
  text: string;
  notes: string | null;
  archived: boolean;
  /** Live phases using this wording. */
  usedBy: number;
  updatedBy: string | null;
  updatedAt: string;
}

const OFFERS_KEY = [...CAL_KEY, "offers"] as const;

export function useOffers() {
  return useQuery({
    queryKey: OFFERS_KEY,
    queryFn: () => calApi<{ offers: Offer[] }>("/marketing-calendar/offers"),
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}

export function createOffer(body: { text: string; notes?: string | null }) {
  return calApi<{ offer: Offer }>("/marketing-calendar/offers", { method: "POST", body: JSON.stringify(body) });
}
export function patchOffer(id: number, patch: { text?: string; notes?: string | null; archived?: boolean }) {
  return calApi<{ offer: Offer }>(`/marketing-calendar/offers/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}
export function deleteOffer(id: number) {
  return calApi<{ ok: true }>(`/marketing-calendar/offers/${id}`, { method: "DELETE" });
}
export function restoreOffer(id: number) {
  return calApi<{ ok: true }>(`/marketing-calendar/offers/${id}/restore`, { method: "POST", body: "{}" });
}
export function invalidateOffers(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: OFFERS_KEY });
}

// ── Klaviyo emails (read-only; built in Klaviyo) + their ONE approval ──────
export interface CalEmail {
  id: string;
  name: string;
  status: "Draft" | "Scheduled" | "Sending" | "Sent";
  /** London day it sends; null = a draft with no date yet. */
  date: string | null;
  sendAt: string | null;
  subject: string | null;
  previewText: string | null;
  abTest: boolean;
  audiences: string[];
  excludedCount: number;
  klaviyoUrl: string;
  approval: {
    status: "approved" | "needs_approval";
    /** What changed in Klaviyo since it was approved. */
    changed: string[];
    /** Counts in "waiting for your approval". */
    awaits: boolean;
    approvedBy: string | null;
    approvedAt: string | null;
  };
}

export interface CalEmailsResponse {
  connected: boolean;
  canApprove: boolean;
  emails: CalEmail[];
  undatedDrafts: CalEmail[];
  error?: string;
}

/** Klaviyo emails in the range plus drafts with no date. Each minute — the
 *  server caches Klaviyo for 3, so this stays cheap. */
export function useCalendarEmails(from: string, to: string) {
  return useQuery({
    queryKey: [...CAL_KEY, "klaviyo", from, to],
    queryFn: () => calApi<CalEmailsResponse>(`/marketing-calendar/klaviyo-emails?from=${from}&to=${to}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: prev => prev,
  });
}

const APPROVALS_KEY = [...CAL_KEY, "approvals"] as const;

/** What waits for approval from today on (the nav badge + the calendar's list). */
export function useApprovalsNeeded(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: [...APPROVALS_KEY, "needed"],
    queryFn: () => calApi<{ today: string; canApprove: boolean; count: number; klaviyoError: string | null; items: CalEmail[] }>("/marketing-calendar/approvals/needed"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: prev => prev,
  });
}

export interface ApprovalHistoryEntry { id: number; action: string; summary: string; userName: string | null; at: string }

export function useApprovalHistory(campaignId: string | null) {
  return useQuery({
    enabled: campaignId != null,
    queryKey: [...APPROVALS_KEY, "history", campaignId],
    queryFn: () => calApi<{ history: ApprovalHistoryEntry[] }>(
      `/marketing-calendar/approvals/history?campaignId=${encodeURIComponent(campaignId ?? "")}`),
    refetchOnWindowFocus: true,
  });
}

/** Approve / undo — recorded in this app only; nothing is written to Klaviyo. */
export function useSetApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ campaignId, approve }: { campaignId: string; approve: boolean }) =>
      calApi<{ ok: true }>(`/marketing-calendar/approvals/${approve ? "approve" : "unapprove"}`, {
        method: "POST",
        body: JSON.stringify({ klaviyoCampaignId: campaignId }),
      }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: APPROVALS_KEY });
      void qc.invalidateQueries({ queryKey: [...CAL_KEY, "klaviyo"] });
    },
  });
}
