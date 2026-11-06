import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SaveChip } from "@/components/save-chip";
import { useAutosave } from "@/hooks/use-autosave";
import { useToast } from "@/hooks/use-toast";
import { jsonFetch } from "@/pages/finance-invoice-drop";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type PaymentStatus = "paid" | "unpaid" | null;

// What this invoice is, and whether it's been paid (Graeme, 6 Nov 2026), on an
// invoice waiting for its transaction. Both save on their own.

export function InvoiceNotes({ invoice }: { invoice: { id: number; notes: string | null; paymentStatus: PaymentStatus } }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(invoice.notes ?? "");
  const [status, setStatus] = useState<PaymentStatus>(invoice.paymentStatus);
  const patch = (body: object) => jsonFetch(`${BASE}/api/finance/invoices/${invoice.id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/finance/invoices"] });
  };
  const auto = useAutosave((value: string) => patch({ notes: value.trim() || null }).then(refresh));
  const saveStatus = useMutation({
    mutationFn: (next: PaymentStatus) => patch({ paymentStatus: next }),
    onMutate: (next) => { const before = status; setStatus(next); return { before }; },
    onSuccess: refresh,
    onError: (e: Error, _next, ctx) => {
      if (ctx) setStatus(ctx.before);
      toast({ title: "Couldn't save that", description: e.message, variant: "destructive" });
    },
  });
  const choice = (value: "unpaid" | "paid", label: string) => (
    <Button
      type="button"
      size="sm"
      variant={status === value ? "default" : "outline"}
      aria-pressed={status === value}
      disabled={saveStatus.isPending}
      onClick={() => saveStatus.mutate(status === value ? null : value)}
    >
      {label}
    </Button>
  );

  return (
    <div className="rounded-xl border p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {choice("unpaid", "Unpaid")}
        {choice("paid", "Paid")}
        <span className="ml-auto"><SaveChip state={auto.state} error={auto.error} onRetry={auto.flush} /></span>
      </div>
      <Textarea
        rows={2}
        aria-label="Notes on this invoice"
        placeholder="Notes: what this is, who it's for…"
        value={notes}
        maxLength={2000}
        onChange={(e) => { setNotes(e.target.value); auto.schedule(e.target.value); }}
        onBlur={auto.flush}
      />
    </div>
  );
}
