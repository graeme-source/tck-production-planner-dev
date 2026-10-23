/**
 * Wish List — React Query hooks over /api/wish-list (Graeme, 23 Oct 2026).
 * One "wish-list" query feeds the page, the add sheet and the pop-up, so a
 * vote or a new item shows everywhere at once.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import type { LinkReading, WishListItem, WishListStatus } from "@/lib/wish-list";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const WISH_LIST_KEY = ["wish-list"] as const;
export const WISH_LIST_ALERTS_KEY = ["wish-list", "alerts"] as const;

/** A failed request with the server's own words ("You've already voted
 *  for this today…") and its status code. */
export class WishListError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(`${BASE}/api/wish-list${path}`, {
    method: init.method ?? "GET",
    credentials: "include",
    headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new WishListError((body as { error?: string }).error ?? "Something went wrong — try again", r.status);
  }
  return r.json() as Promise<T>;
}

export interface WishListResponse { today: string; canManage: boolean; items: WishListItem[] }

export function useWishList(enabled = true) {
  return useQuery<WishListResponse>({
    queryKey: WISH_LIST_KEY,
    queryFn: () => call<WishListResponse>(""),
    enabled,
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });
}

export interface ReadLinkResponse {
  url: string;
  readOk?: boolean;
  reading?: LinkReading;
  duplicate: WishListItem | null;
}

export function useReadLink() {
  return useMutation({
    mutationFn: (url: string) => call<ReadLinkResponse>("/read-link", { method: "POST", body: { url } }),
  });
}

export interface NewWishItem {
  url?: string | null;
  title: string;
  pricePence?: number | null;
  priceIncludesVat?: boolean | null;
  priceExVatPence?: number | null;
  currency?: string;
  imageUrl?: string | null;
  storeName?: string | null;
  notes?: string | null;
  quantity?: number;
}

export interface AddResponse { duplicate: boolean; voted: boolean; message?: string; item: WishListItem }

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: WISH_LIST_KEY });
}

export function useAddWishItem() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (item: NewWishItem) => call<AddResponse>("", { method: "POST", body: item }),
    onSuccess: invalidate,
  });
}

export function useVote() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => call<{ item: WishListItem }>(`/${id}/vote`, { method: "POST", body: {} }),
    // A 409 (already voted today) also means the screen is out of date.
    onSettled: invalidate,
  });
}

export function useEditWishItem() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...patch }: Partial<NewWishItem> & { id: number }) =>
      call<{ item: WishListItem }>(`/${id}`, { method: "PATCH", body: patch }),
    onSuccess: invalidate,
  });
}

export function useSetWishStatus() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, status, note }: { id: number; status: WishListStatus; note?: string | null }) =>
      call<{ item: WishListItem }>(`/${id}/status`, { method: "POST", body: { status, note: note ?? null } }),
    onSuccess: invalidate,
  });
}

export function useDeleteWishItem() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => call<{ ok: true }>(`/${id}`, { method: "DELETE", body: {} }),
    onSuccess: invalidate,
  });
}

/** New items the founder/admins haven't acknowledged. Everyone else gets
 *  an empty list from the server. Keyed by user so a shared iPad never
 *  shows one person's pop-up to the next. */
export function useWishListAlerts() {
  const { state } = useAuth();
  const userId = state.status === "authenticated" ? state.user.id : null;
  return useQuery<{ items: WishListItem[] }>({
    queryKey: [...WISH_LIST_ALERTS_KEY, userId],
    queryFn: () => call<{ items: WishListItem[] }>("/alerts"),
    enabled: userId != null,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}

export function useAckWishListAlerts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (upToId: number) => call<{ ok: true }>("/alerts/ack", { method: "POST", body: { upToId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: WISH_LIST_ALERTS_KEY }),
  });
}
