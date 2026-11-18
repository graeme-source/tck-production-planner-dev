import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SaveChip } from "@/components/save-chip";
import { useAutosave } from "@/hooks/use-autosave";
import { useToast } from "@/hooks/use-toast";
import { jsonFetch } from "@/pages/finance-invoice-drop";
import { CategorySelect } from "@/components/finance/category-select";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type PaymentStatus = "paid" | "unpaid" | null;

// What this invoice is, and whether it's been paid (Graeme, 6 Nov 2026), on an
// invoice in the Inbox. Neither Paid nor Unpaid until someone presses one
// (Graeme, 10 Nov 2026) — a default told the bookkeeper "paid" when nobody
// had said so. Both save on their own. `inline` lays them out in a card's
// headline row (the Inbox), `stacked` in their own box (Outstanding's drop).

export function InvoiceNotes({ invoice, layout = "stacked" }: {
  invoice: { id: number; notes: string | null; paymentStatus: PaymentStatus; categoryId?: number | null };
  layout?: "stacked" | "inline";
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(invoice.notes ?? "");
  const [status, setStatus] = useState<PaymentStatus>(invoice.paymentStatus ?? null);
  const [categoryId, setCategoryId] = useState<number | null>(invoice.categoryId ?? null);
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
  // "What is this item?" (Graeme, 18 Nov 2026) — saves the moment it's chosen.
  const saveCategory = useMutation({
    mutationFn: (next: number | null) => patch({ categoryId: next }),
    onMutate: (next) => { const before = categoryId; setCategoryId(next); return { before }; },
    onSuccess: refresh,
    onError: (e: Error, _next, ctx) => {
      if (ctx) setCategoryId(ctx.before);
      toast({ title: "Couldn't save the category", description: e.message, variant: "destructive" });
    },
  });
  const category = (
    <CategorySelect value={categoryId} onChange={(id) => saveCategory.mutate(id)} required disabled={saveCategory.isPending} className="shrink-0 max-w-full" />
  );
  const choice = (value: "unpaid" | "paid", label: string) => (
    <Button
      type="button"
      size="sm"
      variant={status === value ? "default" : "outline"}
      aria-pressed={status === value}
      disabled={saveStatus.isPending}
      onClick={() => { if (status !== value) saveStatus.mutate(value); }}
    >
      {label}
    </Button>
  );

  const chip = <SaveChip state={auto.state} error={auto.error} onRetry={auto.flush} />;
  const choices = (
    <div className="flex items-center gap-1.5 shrink-0" role="group" aria-label="Paid or unpaid">
      {choice("paid", "Paid")}
      {choice("unpaid", "Unpaid")}
    </div>
  );

  if (layout === "inline") {
    return (
      <>
        {category}
        <div className="flex-1 min-w-[10rem] flex items-center gap-2">
          <Input
            aria-label="Notes on this invoice"
            placeholder="Notes: what this is, who it's for…"
            value={notes}
            maxLength={2000}
            onChange={(e) => { setNotes(e.target.value); auto.schedule(e.target.value); }}
            onBlur={auto.flush}
            className="h-9"
          />
          <span className="shrink-0">{chip}</span>
        </div>
        {choices}
      </>
    );
  }

  return (
    <div className="rounded-xl border p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {category}
        {choices}
        <span className="ml-auto">{chip}</span>
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
