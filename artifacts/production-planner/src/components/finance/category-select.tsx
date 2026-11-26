/**
 * "What is this item?" (Graeme, 18 Nov 2026) — the fixed category on every
 * invoice upload, invoice and card transaction, named exactly as the
 * QuickBooks account it's posted to. The list is data (Finance → Categories),
 * loaded once and shared.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { QboAccountPicker } from "@/components/finance/qbo-account-picker";

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
  const [adding, setAdding] = useState(false);
  const active = useFinanceCategories();
  const options = active.data ?? [];
  const current = value != null && !options.some(c => c.id === value) ? value : null;
  const all = useFinanceCategories(current != null);
  const currentName = current != null ? categoryName(all.data, current) : null;
  if (adding) {
    return (
      <span className={cn("inline-flex", size === "lg" ? "w-full" : "w-full max-w-xl", className)}>
        <QboAccountPicker size={size} onCancel={() => setAdding(false)} onAdded={(c) => { setAdding(false); onChange(c.id); }} />
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
