/**
 * A supplier's default category (Graeme, 26 Nov 2026: "No Fli is always used
 * in subscriptions, so it automatically sets that category for us"). Saves
 * the moment it's chosen; the supplier's outstanding transactions with no
 * category take it straight away, later ones as they arrive, and their
 * invoices once read. Nothing already chosen is changed. Objective I.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CategorySelect } from "@/components/finance/category-select";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function VendorDefaultCategory({ vendorId, value }: { vendorId: number; value: number | null }) {
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<number | null>(value);
  const save = useMutation({
    mutationFn: async (defaultCategoryId: number | null) => {
      const r = await fetch(`${BASE}/api/finance/vendors/${vendorId}`, {
        method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultCategoryId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? "Couldn't save");
      return (j as { filled?: number }).filled ?? 0;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/finance/lines"] }),
    onError: () => setChosen(value),
  });
  const state = save.isPending ? "Saving…"
    : save.isError ? `Not saved — ${(save.error as Error).message}`
    : save.isSuccess ? (save.data > 0 ? `Saved — set on ${save.data} outstanding transaction${save.data === 1 ? "" : "s"}` : "Saved")
    : "";
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Default category:</span>
      <CategorySelect value={chosen} onChange={(id) => { setChosen(id); save.mutate(id); }} disabled={save.isPending} className="max-w-full" />
      <span className={save.isError ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{state || "Its transactions and invoices start with this"}</span>
    </div>
  );
}
