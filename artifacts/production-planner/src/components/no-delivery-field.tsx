/**
 * "No delivery" on the ingredient form (Graeme, 26 Nov 2026 — the used oil
 * collection): the item is ordered through Orders like anything else, but
 * nothing comes to the door — a collection or a service. An order holding
 * only such items still counts as ordered (and closes its kanban), but never
 * goes to Deliveries. Saves straight away with a visible state.
 * Server: GET /api/ingredients/no-delivery, PUT /api/ingredients/:id/no-delivery.
 * Objective C.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const KEY = ["ingredients-no-delivery"] as const;

export function useNoDeliveryIds() {
  return useQuery<number[]>({
    queryKey: KEY,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/ingredients/no-delivery`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60_000,
  });
}

export function NoDeliveryField({ ingredientId }: { ingredientId: number }) {
  const qc = useQueryClient();
  const ids = useNoDeliveryIds();
  const saved = (ids.data ?? []).includes(ingredientId);
  const [on, setOn] = useState(saved);
  useEffect(() => { if (ids.data) setOn(saved); }, [ids.data, saved]);
  const save = useMutation({
    mutationFn: async (noDelivery: boolean) => {
      const res = await fetch(`${BASE}/api/ingredients/${ingredientId}/no-delivery`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noDelivery }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      return body;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  const auto = useAutosave((value: boolean) => save.mutateAsync(value), 0);

  return (
    <div className="rounded-xl border border-border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Delivery</p>
        <SaveChip state={auto.state} error={auto.error} onRetry={auto.flush} />
      </div>
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5 w-4 h-4"
          checked={on}
          disabled={ids.isLoading}
          onChange={e => { setOn(e.target.checked); auto.schedule(e.target.checked); }}
        />
        <span>
          No delivery — a collection or service
          <span className="block text-xs text-muted-foreground">
            Ordered on the Orders page as normal and kept as a record, but nothing comes to the door, so its orders never go to Deliveries.
          </span>
        </span>
      </label>
    </div>
  );
}
