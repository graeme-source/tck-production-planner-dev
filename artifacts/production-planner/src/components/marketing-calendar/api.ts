/**
 * Marketing calendar data (server: api-server/src/routes/marketing-calendar.ts).
 * React Query throughout. The calendar refetches every 25 s and whenever the
 * window regains focus, so two people planning at once see each other's
 * changes without reloading.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface Person { id: number | null; name: string }

export interface Milestone { date: string; label: string; kind: string }

export interface CalEvent {
  id: number;
  title: string;
  startDate: string;
  endDate: string;
  summary: string | null;
  notes: string | null;
  offer: string | null;
  type: string;
  channels: string[];
  audience: string | null;
  status: string;
  source: string;
  createdBy: Person | null;
  updatedBy: Person | null;
  createdAt: string;
  updatedAt: string;
  /** Set when this event belongs to a test box (dates follow the box). */
  testBox?: { id: number; name: string; deliveryDate: string; milestones: Milestone[] } | null;
}

export interface HistoryEntry {
  id: number;
  userId: number | null;
  userName: string | null;
  action: "created" | "edited" | "moved" | "resized" | "deleted";
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
    const err = await res.json().catch(() => ({})) as { error?: string; details?: { formErrors?: string[] } };
    throw new Error(err.details?.formErrors?.[0] ?? err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const CAL_KEY = ["marketing-calendar"] as const;
const POLL_MS = 25_000;

export function useCalendarEvents(from: string, to: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: [...CAL_KEY, "range", from, to],
    queryFn: () => calApi<{ today: string; events: CalEvent[] }>(`/marketing-calendar/events?from=${from}&to=${to}`),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    placeholderData: prev => prev,
  });
}

export function useCalendarEvent(id: number | null) {
  return useQuery({
    queryKey: [...CAL_KEY, "event", id],
    queryFn: () => calApi<{ event: CalEvent; deleted: boolean; deletedBy: string | null; history: HistoryEntry[] }>(`/marketing-calendar/events/${id}`),
    enabled: id != null,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
}

/** Put a changed event straight into every cached range so the grid updates
 *  before the next poll. */
export function patchCachedEvent(qc: QueryClient, event: CalEvent) {
  qc.setQueriesData<{ today: string; events: CalEvent[] }>({ queryKey: [...CAL_KEY, "range"] }, old =>
    old ? { ...old, events: old.events.map(e => (e.id === event.id ? { ...e, ...event, testBox: event.testBox ?? e.testBox } : e)) } : old);
}

export function invalidateCalendar(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: CAL_KEY });
}

export function useSetEventDates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, startDate, endDate }: { id: number; startDate: string; endDate: string }) =>
      calApi<{ event: CalEvent }>(`/marketing-calendar/events/${id}/dates`, {
        method: "PUT",
        body: JSON.stringify({ startDate, endDate }),
      }),
    // Optimistic: the bar stays where it was dropped while the save runs.
    onMutate: ({ id, startDate, endDate }) => {
      qc.setQueriesData<{ today: string; events: CalEvent[] }>({ queryKey: [...CAL_KEY, "range"] }, old =>
        old ? { ...old, events: old.events.map(e => (e.id === id ? { ...e, startDate, endDate } : e)) } : old);
    },
    onSettled: () => { void invalidateCalendar(qc); },
  });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      calApi<{ event: CalEvent }>("/marketing-calendar/events", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { void invalidateCalendar(qc); },
  });
}

export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => calApi<{ ok: true }>(`/marketing-calendar/events/${id}`, { method: "DELETE" }),
    onSuccess: () => { void invalidateCalendar(qc); },
  });
}

export function patchEvent(id: number, patch: Record<string, unknown>) {
  return calApi<{ event: CalEvent }>(`/marketing-calendar/events/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

// ── Klaviyo emails (read-only; Klaviyo is the master) ──────────────────────
export interface KlaviyoEmail {
  id: string;
  name: string;
  status: "Scheduled" | "Sending" | "Sent";
  date: string;
  sendAt: string;
  subject: string | null;
  previewText: string | null;
  abTest: boolean;
  audiences: string[];
  excludedCount: number;
  klaviyoUrl: string;
}

/** Sent and scheduled one-off email campaigns in the range. Refreshes each
 *  minute — the server caches Klaviyo for 3, so this stays cheap. */
export function useKlaviyoEmails(from: string, to: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: [...CAL_KEY, "klaviyo", from, to],
    queryFn: () => calApi<{ connected: boolean; emails: KlaviyoEmail[]; error?: string }>(`/marketing-calendar/klaviyo-emails?from=${from}&to=${to}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: prev => prev,
  });
}

// ── Planned emails (ours — Klaviyo's real sends are above) ─────────────────
export interface PlannedEmail {
  id: number;
  sendDate: string;
  sendTime: string | null;
  subject: string;
  offer: string | null;
  coreMessage: string | null;
  smsSuggestion: string | null;
  cadence: string | null;
  audiences: string[];
  audienceOther: string | null;
  websiteChange: string | null;
  metaChange: string | null;
  notes: string | null;
  status: string;
  klaviyoCampaignId: string | null;
  klaviyoCampaignName: string | null;
  /** The campaign it belongs to by date (worked out by the server). */
  campaignId: number | null;
  campaignTitle: string | null;
  createdBy: Person | null;
  updatedBy: Person | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailHistoryEntry {
  id: number;
  userId: number | null;
  userName: string | null;
  action: "created" | "edited" | "moved" | "linked" | "unlinked" | "deleted";
  summary: string;
  at: string;
}

const EMAILS_KEY = [...CAL_KEY, "emails"] as const;

export function usePlannedEmails(from: string, to: string) {
  return useQuery({
    queryKey: [...EMAILS_KEY, "range", from, to],
    queryFn: () => calApi<{ today: string; emails: PlannedEmail[] }>(`/marketing-calendar/emails?from=${from}&to=${to}`),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    placeholderData: prev => prev,
  });
}

export function usePlannedEmail(id: number | null) {
  return useQuery({
    queryKey: [...EMAILS_KEY, "one", id],
    queryFn: () => calApi<{ email: PlannedEmail; deleted: boolean; deletedBy: string | null; history: EmailHistoryEntry[] }>(`/marketing-calendar/emails/${id}`),
    enabled: id != null,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
}

/** Put a changed email straight into every cached range. */
export function patchCachedEmail(qc: QueryClient, email: PlannedEmail) {
  qc.setQueriesData<{ today: string; emails: PlannedEmail[] }>({ queryKey: [...EMAILS_KEY, "range"] }, old =>
    old ? { ...old, emails: old.emails.map(e => (e.id === email.id ? email : e)) } : old);
  qc.setQueryData([...EMAILS_KEY, "one", email.id], (old: unknown) =>
    old && typeof old === "object" ? { ...(old as object), email } : old);
}

export function invalidateEmails(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: EMAILS_KEY });
}

export function createEmail(body: Record<string, unknown>) {
  return calApi<{ email: PlannedEmail }>("/marketing-calendar/emails", { method: "POST", body: JSON.stringify(body) });
}
export function patchEmail(id: number, patch: Record<string, unknown>) {
  return calApi<{ email: PlannedEmail }>(`/marketing-calendar/emails/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}
export function setEmailDate(id: number, sendDate: string) {
  return calApi<{ email: PlannedEmail }>(`/marketing-calendar/emails/${id}/date`, { method: "PUT", body: JSON.stringify({ sendDate }) });
}

/** Drag a planned email to another day — optimistic, then re-read. */
export function useMoveEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, sendDate }: { id: number; sendDate: string }) => setEmailDate(id, sendDate),
    onMutate: ({ id, sendDate }) => {
      qc.setQueriesData<{ today: string; emails: PlannedEmail[] }>({ queryKey: [...EMAILS_KEY, "range"] }, old =>
        old ? { ...old, emails: old.emails.map(e => (e.id === id ? { ...e, sendDate } : e)) } : old);
    },
    onSettled: () => { void invalidateEmails(qc); },
  });
}

export function useLinkKlaviyo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, klaviyo }: { id: number; klaviyo: { id: string; name: string } | null }) =>
      calApi<{ email: PlannedEmail }>(`/marketing-calendar/emails/${id}/klaviyo`, {
        method: "PUT",
        body: JSON.stringify({ klaviyoCampaignId: klaviyo?.id ?? null, klaviyoCampaignName: klaviyo?.name ?? null }),
      }),
    onSuccess: r => { patchCachedEmail(qc, r.email); void invalidateEmails(qc); },
  });
}

export function useDeleteEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => calApi<{ ok: true }>(`/marketing-calendar/emails/${id}`, { method: "DELETE" }),
    onSuccess: () => { void invalidateEmails(qc); },
  });
}
