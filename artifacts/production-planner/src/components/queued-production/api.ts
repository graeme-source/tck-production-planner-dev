/**
 * Queued test production — data hooks and the packs maths the screen shows
 * (Graeme, 30 Oct 2026: "see how many packs and how many units as well…
 * That way, I don't have to … do the maths").
 */
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface QueueRow {
  id: number;
  productionDate: string;
  recipeId: number;
  batches: number;
  status: string;
  planId: number | null;
  recipeName: string;
  recipeColor: string | null;
  portionsPerBatch: number;
  packSize: number;
}

export type IngredientOrderStatus = "special" | "short" | "check" | "covered";

export type IngredientMark = "ordered" | "not_needed";

export interface IngredientsResponse { deliverBy: string; ingredients: QueueIngredient[] }

export interface QueueIngredient {
  ingredientId: number;
  name: string;
  unit: string;
  required: number;
  status: IngredientOrderStatus;
  mark: IngredientMark | null;
  markedBy: string | null;
  markedAt: string | null;
  /** Last day to order for the deliver-by date (supplier lead time). */
  orderBy: string;
  isRoutine: boolean;
  inbound: number;
  /** What would be ordered for it (0 = nothing). */
  remainingToOrder: number;
  stockNow: number | null;
  weeklyUse: number | null;
  supplierId: number | null;
  supplierName: string | null;
  supplierLeadTimeDays: number | null;
  packWeight: number;
  caseSizePacks: number | null;
}

export interface SalesLine {
  recipeId: number;
  name: string;
  packSize: number;
  portionsPerBatch: number;
  matchedBy: "mapped" | "title" | "none";
  packsSold: number;
  requiredPacks: number;
  batches: number;
  packsMade: number;
  unitsMade: number;
}

export interface QueueSales {
  productionDate: string;
  deliveryDate: string;
  lines: SalesLine[];
  orders: number;
  ordersSyncedAt: string | null;
  refreshError: string | null;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, { credentials: "include", ...init });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

export const QUEUE_KEY = ["queued-production"] as const;
export const ingredientsKey = (date: string) => ["queued-production-ingredients", date] as const;
const salesKey = (productionDate: string, deliveryDate: string | null) => ["queued-production-sales", productionDate, deliveryDate ?? "auto"] as const;
/** Mutation key for batch saves on one date — Create orders waits for them. */
export const batchSaveKey = (date: string) => ["queued-production-batches", date] as const;

export function useQueue() {
  return useQuery({ queryKey: QUEUE_KEY, queryFn: () => json<QueueRow[]>("/api/queued-production") });
}

export function useQueueIngredients(date: string) {
  return useQuery({
    queryKey: ingredientsKey(date),
    queryFn: ({ signal }) => json<IngredientsResponse>(`/api/queued-production/ingredients?date=${date}`, { signal }),
    refetchOnWindowFocus: false,
  });
}

/** Still to order: listed, something to order, not ticked off. */
export const isOutstanding = (i: QueueIngredient) => i.status !== "covered" && i.remainingToOrder > 0 && i.mark == null;

export interface OutstandingDay {
  productionDate: string;
  deliverBy: string;
  lines: Array<{ ingredientId: number; name: string; toOrder: number; unit: string; supplierName: string | null; orderBy: string }>;
}

export const OUTSTANDING_KEY = ["queued-production-outstanding"] as const;

/** Every upcoming queued day with ingredients still to order (Orders page). */
export function useOutstandingQueueIngredients() {
  return useQuery({ queryKey: OUTSTANDING_KEY, queryFn: () => json<{ days: OutstandingDay[] }>("/api/queued-production/outstanding") });
}

export function useMarkIngredient(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { ingredientId: number; mark: IngredientMark | null }) =>
      json<{ ok: true }>("/api/queued-production/mark", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productionDate: date, ...v }) }),
    // The tick shows at once; nothing else in the list depends on it, so
    // the list isn't worked out again (that took long enough on live to
    // look stuck — Graeme, 30 Oct).
    onMutate: async v => {
      await qc.cancelQueries({ queryKey: ingredientsKey(date) });
      const before = qc.getQueryData<IngredientsResponse>(ingredientsKey(date));
      if (before) {
        qc.setQueryData<IngredientsResponse>(ingredientsKey(date), {
          ...before,
          ingredients: before.ingredients.map(i => i.ingredientId === v.ingredientId
            ? { ...i, mark: v.mark, markedBy: v.mark ? "you" : null, markedAt: v.mark ? new Date().toISOString() : null }
            : i),
        });
      }
      return { before };
    },
    onError: (_e, _v, ctx) => { if (ctx?.before) qc.setQueryData(ingredientsKey(date), ctx.before); },
    onSettled: () => { qc.invalidateQueries({ queryKey: OUTSTANDING_KEY }); },
  });
}

/** Packs sold for the delivery this production serves (Friday for a Wednesday). */
export function useQueueSales(productionDate: string, deliveryDate: string | null) {
  return useQuery({
    queryKey: salesKey(productionDate, deliveryDate),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(productionDate),
    staleTime: 5 * 60_000,
    queryFn: () => json<QueueSales>(`/api/queued-production/sales?productionDate=${productionDate}${deliveryDate ? `&deliveryDate=${deliveryDate}` : ""}&refresh=1`),
  });
}

export function useSaveBatches(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: batchSaveKey(date),
    mutationFn: ({ id, batches }: { id: number; batches: number }) =>
      json<QueueRow>(`/api/queued-production/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batches }) }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: QUEUE_KEY });
      qc.invalidateQueries({ queryKey: ingredientsKey(date) });
    },
  });
}

/** True while a batch number on this date is still saving. */
export function useBatchesSaving(date: string): boolean {
  return useIsMutating({ mutationKey: batchSaveKey(date) }) > 0;
}

export async function queueBatches(productionDate: string, items: Array<{ recipeId: number; batches: number }>) {
  return json<{ ok: true }>("/api/queued-production", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productionDate, items }),
  });
}

export async function cancelQueueRow(id: number) {
  return json<{ ok: true }>(`/api/queued-production/${id}`, { method: "DELETE" });
}

export async function createOrders(productionDate: string, ingredientIds: number[]) {
  return json<{ created: Array<{ poId: number; supplierName: string }>; missingSupplier: Array<{ name: string }> }>("/api/queued-production/create-orders", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productionDate, ingredientIds }),
  });
}

/** Place a draft for delivery on `deliverBy` (the day before prep). */
export async function placeOrder(poId: number, deliverBy: string | null) {
  return json<{ expectedDeliveryDate?: string }>(`/api/orders/purchase-orders/${poId}/place`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(deliverBy ? { expectedDeliveryDate: deliverBy } : {}),
  });
}

/** What `batches` make: "95 × 2-packs · 190 units", or "20 units" for single packs. */
export function makesLabel(batches: number, portionsPerBatch: number, packSize: number): string {
  const ppb = portionsPerBatch > 0 ? portionsPerBatch : 10;
  const size = packSize > 0 ? packSize : 1;
  const units = Math.round(batches * ppb * 100) / 100;
  if (size <= 1) return `${units} unit${units === 1 ? "" : "s"}`;
  const packs = Math.round((units / size) * 100) / 100;
  return `${packs} × ${Math.round(size * 100) / 100}-packs · ${units} units`;
}
