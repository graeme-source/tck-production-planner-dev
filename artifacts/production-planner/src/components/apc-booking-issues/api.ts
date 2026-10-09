/**
 * Booking issues today — the data hooks (React Query). The report is read
 * from the server's stored rows: opening it never books anything with APC.
 * Only Retry (a confirmed button) goes back to APC.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PostcodeServiceFacts, PostcodeCall } from "@/components/apc-postcode-service";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const BOOKING_ISSUES_KEY = ["apc-booking-issues"] as const;
const TODAY_KEY = [...BOOKING_ISSUES_KEY, "today"] as const;
const COUNT_KEY = [...BOOKING_ISSUES_KEY, "count"] as const;

export type IssueScenario = "cant_deliver" | "saturday_permanent" | "saturday_temporary" | "other";

export interface Availability { show: boolean; enabled: boolean; reason?: string }

export interface IssueActions {
  retry: Availability;
  retryAs: Availability & { code?: string };
  reschedule: Availability & { weekdaysOnly: boolean; emailVariant: "temporary_saturday" | "permanent_saturday"; defaultSendEmail: boolean };
  emailCantDeliver: Availability;
  escalate: Availability;
  refund: Availability;
  dealtWith: Availability;
}

export interface IssueLogEntry { kind: string; at: string; byName: string | null; detail?: string | null }

export interface BookingIssue {
  id: number;
  orderId: number;
  orderName: string;
  adminUrl: string | null;
  dispatchTag: string;
  customerName: string | null;
  customerEmail: string | null;
  postcode: string | null;
  reason: string | null;
  usedServiceCode: string | null;
  saturdayAttempt: boolean;
  refusedNoService: boolean;
  dataFixable: boolean;
  attempts: number;
  firstFailedAt: string;
  lastFailedAt: string;
  firstFailedBy: string | null;
  resolvedAt: string | null;
  resolvedNote: string | null;
  dealtWithAt: string | null;
  dealtWithBy: string | null;
  scenario: IssueScenario;
  wording: { title: string; explain: string; whatToDo: string };
  postcodeService: (Omit<PostcodeServiceFacts, "saturdayCutoff"> & { saturdayCutoff: string | null }) | null;
  postcodeCheck: string | null;
  postcodeAdvice: { text: string; kind: string; service: "saturday" | "weekday"; call?: PostcodeCall } | null;
  state: {
    emailedAt: string | null; emailedTo: string | null; rescheduledTo: string | null;
    escalatedAt: string | null; escalatedBy: string | null; refundDone: boolean; refundDoneBy: string | null;
  };
  done: boolean;
  actions: IssueActions;
  log: IssueLogEntry[];
}

export interface TodayReport {
  date: string;
  canCourier: boolean;
  open: number;
  total: number;
  issues: BookingIssue[];
  escalateTo: string[];
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

function post<T>(path: string, data: unknown): Promise<T> {
  return fetch(`${BASE}/api/fulfilment${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then(r => json<T>(r));
}

/** The URL the report is read from — a GET of stored rows, never booking. */
export const TODAY_REPORT_URL = "/api/fulfilment/booking-issues/today";

export function useBookingIssuesToday(enabled = true) {
  return useQuery<TodayReport>({
    queryKey: TODAY_KEY,
    queryFn: async () => json(await fetch(`${BASE}${TODAY_REPORT_URL}`, { credentials: "include" })),
    enabled,
    // Several people work the same report (office on the phone, packer at
    // the bench) — keep it fresh without anyone pressing anything.
    refetchInterval: 30_000,
  });
}

export function useBookingIssuesCount(enabled = true) {
  return useQuery<{ date: string; open: number; total: number }>({
    queryKey: COUNT_KEY,
    queryFn: async () => json(await fetch(`${BASE}/api/fulfilment/booking-issues/today/count`, { credentials: "include" })),
    enabled,
    refetchInterval: 60_000,
  });
}

function useIssueMutation<V, T = { ok: true }>(fn: (v: V) => Promise<T>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries({ queryKey: BOOKING_ISSUES_KEY }),
  });
}

export const useSendCantDeliverEmail = () =>
  useIssueMutation((v: { id: number; confirmOrderName: string }) =>
    post<{ ok: true; to: string }>(`/booking-issues/${v.id}/cant-deliver-email`, { confirmOrderName: v.confirmOrderName }));

export const useEscalateIssue = () =>
  useIssueMutation((v: { id: number; note?: string }) =>
    post<{ ok: true; to: string[] }>(`/booking-issues/${v.id}/escalate`, v.note ? { note: v.note } : {}));

export const useRefundTick = () =>
  useIssueMutation((v: { id: number; done: boolean }) => post(`/booking-issues/${v.id}/refund`, { done: v.done }));

export const useDealtWith = () =>
  useIssueMutation((v: { id: number; done: boolean }) => post(`/booking-issues/${v.id}/dealt-with`, { done: v.done }));

export interface RetryOutcome { orderId: number; orderName: string; status: "booked" | "skipped" | "failed"; reason?: string; waybill?: string }

/** Book again with APC — a real, chargeable booking; always confirmed first.
 *  `retry: true` turns on the server's duplicate check. The server folds the
 *  outcome into the stored report itself. */
export const useRetryIssues = () =>
  useIssueMutation((v: { tag: string; orderIds: number[]; code?: string }) =>
    post<{ results: RetryOutcome[] }>("/batch-book", {
      tag: v.tag, orderIds: v.orderIds, retry: true, ...(v.code ? { serviceCodeOverride: v.code } : {}),
    }));

export function useCantDeliverPreview(id: number | null) {
  return useQuery<{ orderName: string; customerName: string | null; to: string | null; subject: string; body: string }>({
    queryKey: [...BOOKING_ISSUES_KEY, "cant-deliver-email", id],
    queryFn: async () => json(await fetch(`${BASE}/api/fulfilment/booking-issues/${id}/cant-deliver-email`, { credentials: "include" })),
    enabled: id != null,
    staleTime: 0,
    retry: false,
  });
}
