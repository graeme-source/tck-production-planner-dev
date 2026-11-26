/**
 * The Supplier box on "Add a transaction" (Graeme, 26 Nov 2026): names from
 * invoices and card statements drop down as you type, and a likely typo gets
 * "Did you mean Klaviyo Inc?" so the transaction is spelled like its invoice
 * and matches it by name. Objective I.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { didYouMean, matchSupplierNames, type SupplierName } from "@/lib/supplier-name-suggest";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function SupplierNameInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const names = useQuery<SupplierName[]>({
    queryKey: ["/api/finance/supplier-names"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/finance/supplier-names`, { credentials: "include" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? "Couldn't load supplier names");
      return (j as { names: SupplierName[] }).names;
    },
    staleTime: 5 * 60_000,
  });
  const list = names.data ?? [];
  const matches = useMemo(() => matchSupplierNames(list, value), [list, value]);
  const exact = matches.some((m) => m.name.toLowerCase() === value.trim().toLowerCase());
  const suggestion = useMemo(() => (exact ? null : didYouMean(list, value)), [list, value, exact]);

  return (
    <div className="relative space-y-1">
      <Input
        id={id}
        value={value}
        autoComplete="off"
        placeholder="Start typing, e.g. Klaviyo"
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
      />
      {open && matches.length > 0 && !exact && (
        <ul className="absolute z-50 left-0 right-0 top-11 max-h-60 overflow-y-auto rounded-xl border bg-background shadow-lg divide-y" role="listbox" aria-label="Known suppliers">
          {matches.map((m) => (
            <li key={m.name}>
              <button type="button" role="option" aria-selected={false}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(m.name); setOpen(false); }}
                className="w-full text-left min-h-[44px] px-3 py-2 text-sm hover:bg-secondary">
                {m.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {suggestion && (
        <p className="text-sm text-amber-800 dark:text-amber-300">
          Did you mean{" "}
          <button type="button" className="font-semibold underline underline-offset-2" onClick={() => onChange(suggestion)}>{suggestion}</button>?
          {" "}That's how it's spelled on its invoices.
        </p>
      )}
    </div>
  );
}
