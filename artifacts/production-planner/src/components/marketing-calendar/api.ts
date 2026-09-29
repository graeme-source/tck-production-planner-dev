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

export function useCalendarEvents(from: string, to: string) {
  return useQuery({
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
