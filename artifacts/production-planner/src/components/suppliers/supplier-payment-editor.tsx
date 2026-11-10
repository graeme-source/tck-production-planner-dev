/**
 * Payment terms and the other names on a supplier's invoices, in the Edit
 * Supplier dialog (Graeme, 10 Nov 2026). Objective I. Each change saves on
 * its own (PUT/POST/DELETE /api/suppliers/:id/...); the Finance Inbox shows
 * an invoice's supplier and how it's paid from these.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type PaymentTerms = "paid_when_ordered" | "on_account";
interface SupplierPayment {
  supplierId: number;
  paymentTerms: PaymentTerms;
  invoiceNames: Array<{ id: number; name: string }>;
}

async function call(path: string, init?: RequestInit): Promise<SupplierPayment> {
  const res = await fetch(`${BASE}/api/suppliers/${path}`, {
    credentials: "include",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as SupplierPayment;
}

const TERMS: Array<{ value: PaymentTerms; label: string; hint: string }> = [
  { value: "paid_when_ordered", label: "Paid when ordered", hint: "Card, at the time — the usual" },
  { value: "on_account", label: "On account", hint: "They invoice us; the team pays on terms" },
];

export function SupplierPaymentEditor({ supplierId }: { supplierId: number }) {
  const queryClient = useQueryClient();
  const key = ["/api/suppliers", supplierId, "payment"];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => call(`${supplierId}/payment`) });
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const onDone = (next: SupplierPayment) => {
    queryClient.setQueryData(key, next);
    queryClient.invalidateQueries({ queryKey: ["/api/finance/invoices"] });
    setError(null);
    setSaved(true);
  };
  const onFail = (e: Error) => { setError(e.message); setSaved(false); };

  const setTerms = useMutation({
    mutationFn: (paymentTerms: PaymentTerms) => call(`${supplierId}/payment-terms`, { method: "PUT", body: JSON.stringify({ paymentTerms }) }),
    onMutate: () => setSaved(false),
    onSuccess: onDone,
    onError: onFail,
  });
  const addName = useMutation({
    mutationFn: (n: string) => call(`${supplierId}/invoice-names`, { method: "POST", body: JSON.stringify({ name: n }) }),
    onMutate: () => setSaved(false),
    onSuccess: (next) => { onDone(next); setName(""); },
    onError: onFail,
  });
  const removeName = useMutation({
    mutationFn: (nameId: number) => call(`${supplierId}/invoice-names/${nameId}`, { method: "DELETE" }),
    onMutate: () => setSaved(false),
    onSuccess: onDone,
    onError: onFail,
  });
  const busy = setTerms.isPending || addName.isPending || removeName.isPending;
  const submitName = () => { if (name.trim().length >= 2 && !busy) addName.mutate(name.trim()); };

  return (
    <div className="mt-6 pt-6 border-t border-border space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Payment terms</h3>
        <span className="text-sm font-semibold inline-flex items-center gap-1" aria-live="polite">
          {busy && <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Saving…</span>}
          {!busy && saved && !error && <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><Check className="w-4 h-4" /> Saved</span>}
          {!busy && error && <span className="text-destructive">{error}</span>}
        </span>
      </div>

      {isLoading || !data ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Payment terms">
            {TERMS.map((t) => {
              const on = data.paymentTerms === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={busy}
                  onClick={() => { if (!on) setTerms.mutate(t.value); }}
                  className={cn(
                    "rounded-xl border-2 px-3 py-2 text-left transition-colors",
                    on ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50",
                  )}
                >
                  <span className="block text-sm font-semibold">{t.label}</span>
                  <span className="block text-xs text-muted-foreground">{t.hint}</span>
                </button>
              );
            })}
          </div>

          <div>
            <p className="text-sm font-medium">Other names on their invoices</p>
            <p className="text-xs text-muted-foreground mb-2">So the Finance Inbox knows it's them — e.g. "Northamptonshire Food Services Ltd" for NFS Meats.</p>
            {data.invoiceNames.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {data.invoiceNames.map((n) => (
                  <span key={n.id} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">
                    {n.name}
                    <button
                      type="button"
                      aria-label={`Remove ${n.name}`}
                      disabled={busy}
                      onClick={() => removeName.mutate(n.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitName(); } }}
                placeholder="Name as it's on their invoices"
                maxLength={200}
                className="flex-1 min-w-0 px-3 py-2 bg-background border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                type="button"
                onClick={submitName}
                disabled={busy || name.trim().length < 2}
                className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-border text-sm font-medium hover:bg-muted/50 disabled:opacity-50"
              >
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
