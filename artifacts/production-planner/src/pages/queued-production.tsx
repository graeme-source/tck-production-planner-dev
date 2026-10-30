// Queued test production — decide batches for a future production date long
// before the plan exists, see which ingredients need ordering, and raise
// their purchase orders early. Queued rows land on the plan automatically
// when the planner creates it through the normal flow (violet banner +
// "queued" badge there).
//
// 30 Oct 2026 (Graeme): batches suggested from the delivery's sales (sold +
// 5 packs, whole batches), packs and units shown beside every batch number,
// batch numbers save as you type and the order quantities follow, and
// routine ingredients the test would run out are listed to order too.
// Pieces live in components/queued-production/.

import { useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowLeft, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { toast } from "@/hooks/use-toast";
import { QUEUE_KEY, cancelQueueRow, makesLabel, useQueue, useQueueSales, type QueueRow } from "@/components/queued-production/api";
import { AddQueueForm } from "@/components/queued-production/add-queue-form";
import { QueueRowItem } from "@/components/queued-production/queue-row";
import { DateIngredients } from "@/components/queued-production/date-ingredients";

export default function QueuedProductionPage() {
  const [, navigate] = useLocation();
  const searchStr = useSearch();
  const initialDate = new URLSearchParams(searchStr).get("date") ?? "";
  const queryClient = useQueryClient();
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set(initialDate ? [initialDate] : []));
  const { data: rows, isLoading } = useQueue();

  const refetchAll = () => {
    queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
    queryClient.invalidateQueries({ queryKey: ["queued-production-ingredients"] });
  };

  const byDate = useMemo(() => {
    const map = new Map<string, QueueRow[]>();
    for (const r of rows ?? []) {
      const list = map.get(r.productionDate) ?? [];
      list.push(r);
      map.set(r.productionDate, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const toggleDate = (date: string) => setExpandedDates(prev => {
    const next = new Set(prev);
    if (next.has(date)) next.delete(date); else next.add(date);
    return next;
  });

  return (
    <div className="p-4 md:p-6 space-y-5">
      <PageHeader
        title="Queued Test Production"
        description="Test batches for a future day, and what to order for them."
      />
      <button onClick={() => navigate("/plans")} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" /> Back to Production Plans
      </button>

      <AddQueueForm initialDate={initialDate} onSaved={refetchAll} />

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-6"><Loader2 className="w-5 h-5 animate-spin" /> Loading queue…</div>
      ) : byDate.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card py-10 text-center text-muted-foreground text-sm">
          Nothing queued yet. Pick a date and recipes above — ingredient requirements and early ordering appear here once queued.
        </div>
      ) : (
        byDate.map(([date, dateRows]) => (
          <DateCard key={date} date={date} rows={dateRows} expanded={expandedDates.has(date)} onToggle={() => toggleDate(date)} onChanged={refetchAll} />
        ))
      )}
    </div>
  );
}

function DateCard({ date, rows, expanded, onToggle, onChanged }: {
  date: string; rows: QueueRow[]; expanded: boolean; onToggle: () => void; onChanged: () => void;
}) {
  const sales = useQueueSales(expanded ? date : "", null);
  const saleByRecipe = new Map((sales.data?.lines ?? []).map(l => [l.recipeId, l]));
  const deliveryLabel = sales.data ? format(parseISO(sales.data.deliveryDate), "EEE d MMM") : null;
  const totalBatches = rows.reduce((s, r) => s + r.batches, 0);
  const allPlanned = rows.every(r => r.status === "planned");

  const remove = async (row: QueueRow) => {
    if (!window.confirm(`Remove ${row.recipeName} (${row.batches} batches) from the ${format(parseISO(row.productionDate), "EEE d MMM")} queue?`)) return;
    try {
      await cancelQueueRow(row.id);
      onChanged();
    } catch (err) {
      toast({ title: "Couldn't remove it", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <button onClick={onToggle} className="w-full flex items-center justify-between gap-2 text-left">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
          <span className="text-lg font-semibold">{format(parseISO(date), "EEEE d MMM yyyy")}</span>
          <span className="text-sm text-muted-foreground">{totalBatches} batch{totalBatches === 1 ? "" : "es"} · {rows.length} recipe{rows.length === 1 ? "" : "s"}</span>
          {allPlanned && <span className="text-[11px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded font-medium">on plan</span>}
        </span>
        {expanded ? <ChevronUp className="w-5 h-5 flex-shrink-0" /> : <ChevronDown className="w-5 h-5 flex-shrink-0" />}
      </button>
      {!expanded && (
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.map(r => `${r.recipeName}: ${makesLabel(r.batches, r.portionsPerBatch, r.packSize)}`).join(" · ")}
        </p>
      )}
      {expanded && (
        <div className="mt-3 space-y-2">
          <div className="grid gap-2 grid-cols-1 xl:grid-cols-2">
            {rows.map(row => (
              <QueueRowItem key={row.id} row={row} sale={saleByRecipe.get(row.recipeId)} deliveryLabel={deliveryLabel} onRemove={() => void remove(row)} />
            ))}
          </div>
          <DateIngredients date={date} onOrdersCreated={onChanged} />
        </div>
      )}
    </div>
  );
}
