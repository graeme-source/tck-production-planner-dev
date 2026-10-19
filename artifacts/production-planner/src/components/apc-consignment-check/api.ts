/**
 * APC consignment check — data hooks (React Query). Incident #136845
 * (19 Oct 2026): an order went out on a consignment cancelled eight days
 * earlier. The check lists orders that went out on an old or cancelled
 * booking, and old bookings that may still be live at APC.
 *
 * Reading never writes to APC. Only "Yes, cancel it in APC" does, and only
 * for a booking the app has already retired.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export const APC_CHECK_KEY = ["apc-consignment-check"] as const;

export interface CheckRow {
  waybill: string;
  orderId: number | null;
  orderName: string | null;
  customerName: string | null;
  bookedForDeliveryDate: string | null;
  currentDeliveryDate: string | null;
  collectionDate: string | null;
  bookedAt: string | null;
  dispatchDate: string | null;
  pushedToShopifyAt: string | null;
  apcStatus: string | null;
  apcDeadStatus: string | null;
  apcStatusCheckedAt: string | null;
  cancelledReason: string | null;
  supersededReason: string | null;
  problems: Array<{ kind: string; label: string }>;
  cancelDecision: string | null;
  cancelDecidedBy: string | null;
}

export interface CheckReport {
  ranAt: string | null;
  days: number;
  checkedRows: number;
  apcReads: number;
  apcUnreachable: number;
  mismatches: CheckRow[];
  oldBookings: CheckRow[];
  lastRun: { ranAt: string; checkedRows: number; apcReads: number; apcUnreachable: number; found: number; oldBookings: number } | null;
  adminOrderBase: string;
}

export interface OldBooking {
  waybill: string;
  collectionDate: string | null;
  supersededReason: string | null;
  apcStatus: string | null;
  liveInApc: boolean | null;
  apcError?: string;
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((body as { error?: string }).error ?? `Request failed (${res.status})`) as Error & { cancelByHand?: boolean };
    err.cancelByHand = !!(body as { cancelByHand?: boolean }).cancelByHand;
    throw err;
  }
  return body as T;
}

export function useConsignmentCheck(days: number) {
  return useQuery<CheckReport>({
    queryKey: [...APC_CHECK_KEY, "report", days],
    queryFn: async () => json(await fetch(`${BASE}/api/fulfilment/apc-consignment-check?days=${days}`, { credentials: "include" })),
    staleTime: 30_000,
  });
}

export function useRunConsignmentCheck(days: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => json<CheckReport>(await fetch(`${BASE}/api/fulfilment/apc-consignment-check/run`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days }),
    })),
    onSuccess: (report) => qc.setQueryData([...APC_CHECK_KEY, "report", days], report),
  });
}

/** An order's retired bookings, with APC's live status — asked once, when
 *  the reschedule has gone through. */
export function useOldApcBookings(orderId: number, enabled: boolean) {
  return useQuery<{ orderId: number; oldBookings: OldBooking[] }>({
    queryKey: [...APC_CHECK_KEY, "old-bookings", orderId],
    queryFn: async () => json(await fetch(`${BASE}/api/fulfilment/orders/${orderId}/old-apc-bookings`, { credentials: "include" })),
    enabled,
    staleTime: 0,
    retry: false,
  });
}

export function useCancelInApc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (waybill: string) => json<{ ok: true; waybill: string }>(await fetch(`${BASE}/api/fulfilment/consignments/${encodeURIComponent(waybill)}/apc-cancel`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    })),
    onSuccess: () => qc.invalidateQueries({ queryKey: APC_CHECK_KEY }),
  });
}

export function useCancelDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { waybill: string; decision: "cancel_by_hand" | "keep" }) => json<{ ok: true }>(await fetch(`${BASE}/api/fulfilment/consignments/${encodeURIComponent(v.waybill)}/apc-cancel-decision`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: v.decision }),
    })),
    onSuccess: () => qc.invalidateQueries({ queryKey: APC_CHECK_KEY }),
  });
}

/** "Wed 7 Oct" */
export function friendlyDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: /^\d{4}-\d{2}-\d{2}$/.test(iso) ? "UTC" : "Europe/London" });
}
