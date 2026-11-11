/**
 * Friday dispatch check — data hooks (React Query). Reading the check never
 * writes anything. The email is sent only from a confirmed button press;
 * moves go through the Reschedule pop-up.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export const FRIDAY_CHECK_KEY = ["friday-dispatch-check"] as const;

export type FridayStatus = "ok" | "no_saturday" | "at_risk" | "unknown";

export interface Alternative { possible: boolean; deliveryDate: string; label: string; note: string | null }

export interface DoneState {
  emailedAt: string | null; emailedBy: string | null; emailedTo: string | null;
  movedAt: string | null; movedBy: string | null; movedTo: string | null;
}

export interface FridayCheckRow {
  orderId: number;
  orderName: string;
  customerName: string;
  postcode: string | null;
  status: FridayStatus;
  reason: string;
  outward: string | null;
  depot: string | null;
  thursday: Alternative;
  nextWeek: Alternative;
  canOfferThursday: boolean;
  canEmail: boolean;
  emailNote: string | null;
  /** Test production / 8-pack bags: never moved from here — by hand. */
  lockedReason: string | null;
  done: DoneState | null;
}

export interface MovedRow extends DoneState { orderId: number; orderName: string }

export interface FridayCheck {
  today: string;
  dispatchDate: string;
  dates: {
    dispatchDate: string; deliveryDate: string; replyBy: string;
    thursdayDispatch: string; thursdayDelivery: string; nextWeekDispatch: string; nextWeekDelivery: string;
    dispatchLabel: string; deliveryLabel: string; replyByLabel: string;
  };
  summary: { total: number; ok: number; noSaturday: number; atRisk: number; unknown: number; moved: number };
  results: FridayCheckRow[];
  moved: MovedRow[];
  canCourier: boolean;
  adminOrderBase: string;
  refusalsConsidered: number;
  refusalDays: number;
  /** False: Zapiet's calendar couldn't be read, so the move-to date used our closure list only. */
  calendarChecked?: boolean;
  source: string;
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

/** null = let the server pick the coming Friday. */
export function useFridayCheck(dispatchDate: string | null) {
  return useQuery<FridayCheck>({
    queryKey: [...FRIDAY_CHECK_KEY, dispatchDate ?? "coming"],
    queryFn: async () => {
      const q = dispatchDate ? `?dispatchDate=${dispatchDate}` : "";
      return json(await fetch(`${BASE}/api/fulfilment/friday-check${q}`, { credentials: "include" }));
    },
    // Reads every order from Shopify — no background polling; Refresh is a button.
    staleTime: 60_000,
    retry: false,
  });
}

export interface EmailDraft {
  orderName: string; customerName: string | null; to: string | null; subject: string; body: string;
  offerThursday: boolean; alreadyEmailedAt: string | null; alreadyEmailedBy: string | null;
  /** Where "Reschedule & email" moves it: the Tuesday after (Monday's dispatch). */
  newDelivery: string; newDeliveryLabel: string;
  /** The real choose-a-day link (null when the assistant couldn't make one). */
  link: string | null; linkError: string | null;
}

export interface RescheduleResult {
  ok: true; to: string; movedTo: string;
  emailed: boolean; emailError: string | null;
  linkIncluded: boolean; linkError: string | null;
}

export function useNoSaturdayEmailDraft(orderId: number | null, dispatchDate: string) {
  return useQuery<EmailDraft>({
    queryKey: [...FRIDAY_CHECK_KEY, "email", orderId, dispatchDate],
    queryFn: async () => json(await fetch(`${BASE}/api/fulfilment/friday-check/orders/${orderId}/email?dispatchDate=${dispatchDate}`, { credentials: "include" })),
    enabled: orderId != null,
    staleTime: 0,
    retry: false,
  });
}

export function useSendNoSaturdayEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { orderId: number; dispatchDate: string; confirmOrderName: string }) =>
      json<RescheduleResult>(await fetch(`${BASE}/api/fulfilment/friday-check/orders/${v.orderId}/email`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dispatchDate: v.dispatchDate, confirmOrderName: v.confirmOrderName }),
      })),
    onSettled: () => qc.invalidateQueries({ queryKey: FRIDAY_CHECK_KEY }),
  });
}

/** YYYY-MM-DD ± days, date-only. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Today's date in London, YYYY-MM-DD. */
export function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** The Friday on or after a date — so any day picked lands on a Friday. */
export function fridayOnOrAfter(date: string): string {
  let d = date;
  for (let i = 0; i < 7 && new Date(`${d}T12:00:00Z`).getUTCDay() !== 5; i++) d = addDays(d, 1);
  return d;
}

/** "Fri 13 Nov" */
export function shortDay(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`));
}

/** "Wed 11 Nov, 10:42" for a timestamp, in London. */
export function when(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })
    .format(new Date(iso));
}
