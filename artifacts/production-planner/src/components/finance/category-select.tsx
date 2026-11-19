/**
 * "What is this item?" (Graeme, 18 Nov 2026) — the fixed category on every
 * invoice upload, invoice and card transaction, named exactly as the
 * QuickBooks account it's posted to. The list is data (Finance → Categories),
 * loaded once and shared.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface FinanceCategory {
  id: number; name: string; sortOrder: number; hidden: boolean;
  /** Choosing it means no VAT invoice will come (e.g. "dla"). */
  noVatReason?: string | null;
}

export const FINANCE_CATEGORIES_KEY = ["/api/finance/categories"] as const;

export function useFinanceCategories(all = false) {
  return useQuery<FinanceCategory[]>({
    queryKey: all ? [...FINANCE_CATEGORIES_KEY, "all"] : FINANCE_CATEGORIES_KEY,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/finance/categories${all ? "?all=1" : ""}`, { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? "Couldn't load the categories");
      return (body as { categories: FinanceCategory[] }).categories;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** The name for a category id, even one since hidden from the dropdown. */
export function categoryName(categories: FinanceCategory[] | undefined, id: number | null | undefined): string | null {
  if (id == null) return null;
  return categories?.find(c => c.id === id)?.name ?? null;
}

/**
 * The dropdown itself. `size="lg"` for the upload steps (big, can't miss),
 * `sm` for a card's headline row. An item already set to a hidden category
 * still shows it, so nothing silently changes.
 */
const ADD = "__add";

export function CategorySelect({
  value, onChange, size = "sm", required = false, disabled = false, className, id, selectRef, allowAdd = false,
}: {
  value: number | null;
  onChange: (id: number | null) => void;
  size?: "sm" | "lg";
  required?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
  selectRef?: React.Ref<HTMLSelectElement>;
  /** Finance only: "+ Add a category…" at the bottom (Graeme, 19 Nov 2026). */
  allowAdd?: boolean;
}) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const add = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(`${BASE}/api/finance/categories`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? "Couldn't add the category");
      return (body as { category: FinanceCategory }).category;
    },
    onSuccess: async (c) => {
      await queryClient.invalidateQueries({ queryKey: FINANCE_CATEGORIES_KEY });
      setAdding(false); setNewName("");
      onChange(c.id);
    },
  });
  const active = useFinanceCategories();
  const options = active.data ?? [];
  const current = value != null && !options.some(c => c.id === value) ? value : null;
  const all = useFinanceCategories(current != null);
  const currentName = current != null ? categoryName(all.data, current) : null;
  if (adding) {
    return (
      <span className={cn("inline-flex flex-col gap-1", size === "lg" && "w-full", className)}>
        <span className="inline-flex items-center gap-2 flex-wrap">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && newName.trim()) add.mutate(newName); if (e.key === "Escape") setAdding(false); }}
            placeholder="Its QuickBooks account name, exactly"
            aria-label="New category name"
            className={cn("rounded-xl border-2 border-primary bg-background px-3 font-semibold focus:outline-none", size === "lg" ? "h-14 text-lg flex-1 min-w-[12rem]" : "h-9 text-sm min-w-[14rem]")}
          />
          <button type="button" disabled={!newName.trim() || add.isPending} onClick={() => add.mutate(newName)}
            className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">
            {add.isPending ? "Adding…" : "Add"}
          </button>
          <button type="button" onClick={() => { setAdding(false); setNewName(""); add.reset(); }}
            className="h-9 px-3 rounded-lg border text-sm font-semibold">Cancel</button>
        </span>
        {add.isError && <span className="text-xs text-destructive">{(add.error as Error).message}</span>}
      </span>
    );
  }

  return (
    <select
      id={id}
      ref={selectRef}
      value={value ?? ""}
      disabled={disabled || active.isLoading}
      onChange={e => {
        if (e.target.value === ADD) { setAdding(true); return; }
        onChange(e.target.value ? Number(e.target.value) : null);
      }}
      aria-label="What is this item?"
      className={cn(
        "rounded-xl border-2 bg-background font-semibold focus:outline-none focus:border-primary",
        size === "lg" ? "w-full h-14 px-3 text-lg" : "h-9 px-2 text-sm",
        required && value == null ? "border-amber-400" : "border-border",
        value == null && "text-muted-foreground",
        className,
      )}
    >
      <option value="">{active.isLoading ? "Loading…" : active.isError ? "Couldn't load the list" : "Choose…"}</option>
      {current != null && <option value={current}>{currentName ?? "Hidden category"}</option>}
      {options.map(c => <option key={c.id} value={c.id}>{c.name}{c.noVatReason === "dla" ? " (no VAT invoice)" : ""}</option>)}
      {allowAdd && <option value={ADD}>+ Add a category…</option>}
    </select>
  );
}
