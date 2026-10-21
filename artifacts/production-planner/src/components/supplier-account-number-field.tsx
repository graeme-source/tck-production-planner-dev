/**
 * Our account number with a supplier (Graeme, 21 Oct 2026; migration 0213),
 * typed straight in on the supplier record and autosaved with a visible
 * save state (charter rule 5). It's quoted near the top of the goods-in
 * issue email to the account manager ("Account number: 1867332"); blank =
 * left out of the email. Objective C.
 *
 * Server: PATCH /api/suppliers/:id/account-number (manager/admin).
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListSuppliersQueryKey } from "@workspace/api-client-react";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { CONTACTS_KEY } from "@/components/contacts/contacts-api";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function saveAccountNumber(supplierId: number, value: string): Promise<void> {
  const res = await fetch(`${BASE}/api/suppliers/${supplierId}/account-number`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountNumber: value.trim() === "" ? null : value.trim() }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `Couldn't save (${res.status})`);
  }
}

export function SupplierAccountNumberField({ supplierId, initial }: { supplierId: number; initial: string | null }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(initial ?? "");
  const auto = useAutosave(async (next: string) => {
    await saveAccountNumber(supplierId, next);
    void queryClient.invalidateQueries({ queryKey: getListSuppliersQueryKey() });
    void queryClient.invalidateQueries({ queryKey: CONTACTS_KEY });
  });
  const change = (next: string) => { setValue(next); auto.schedule(next); };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-1">
        <label htmlFor={`supplier-account-number-${supplierId}`} className="text-sm font-medium">Our account number</label>
        <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />
      </div>
      <input
        id={`supplier-account-number-${supplierId}`}
        value={value}
        onChange={e => change(e.target.value)}
        onBlur={() => void auto.flush()}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
        maxLength={100}
        inputMode="text"
        placeholder="e.g. 1867332"
        className={cn(
          "w-full px-3 py-2 bg-background border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30",
          auto.state === "error" ? "border-destructive" : "border-border",
        )}
      />
      <span className="text-xs text-muted-foreground">Saves as you type. Quoted at the top of goods-in issue emails.</span>
    </div>
  );
}
