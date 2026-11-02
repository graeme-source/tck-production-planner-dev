/**
 * Queued test production for one day, shown on Production Plans when that
 * day has no plan yet (Graeme, 30 Oct 2026: "I should be able to see it
 * here, so I can edit it from here, delete it, or go into it"). Batches
 * save as you type, the bin removes a recipe, Open goes to the full queue
 * page (sales suggestions + ingredients to order). Renders nothing when the
 * day has nothing queued.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowRight, FlaskConical } from "lucide-react";
import { OUTSTANDING_KEY, QUEUE_KEY, useQueue } from "./api";
import { QueueRowItem, removeQueueRow } from "./queue-row";

export function DayQueuePanel({ date }: { date: string }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { data } = useQueue();
  const rows = (data ?? []).filter(r => r.productionDate === date);
  if (rows.length === 0) return null;

  const totalBatches = rows.reduce((s, r) => s + r.batches, 0);
  const refetch = () => {
    queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
    queryClient.invalidateQueries({ queryKey: ["queued-production-ingredients"] });
    queryClient.invalidateQueries({ queryKey: OUTSTANDING_KEY });
  };

  return (
    <div className="mb-3 rounded-2xl border border-violet-400/50 bg-violet-500/5 p-4 text-left space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <FlaskConical className="w-5 h-5 text-violet-700 dark:text-violet-300 flex-shrink-0" />
        <span className="text-lg font-semibold text-foreground">Queued test production</span>
        <span className="text-sm text-muted-foreground">
          {totalBatches} batch{totalBatches === 1 ? "" : "es"} · {rows.length} recipe{rows.length === 1 ? "" : "s"}
        </span>
        <button
          onClick={() => navigate(`/plans/queued?date=${date}`)}
          className="ml-auto h-11 px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold flex items-center gap-1.5"
        >
          Open · ingredients to order <ArrowRight className="w-4 h-4" />
        </button>
      </div>
      <div className="grid gap-2 grid-cols-1 xl:grid-cols-2">
        {rows.map(row => (
          <QueueRowItem key={row.id} row={row} sale={undefined} deliveryLabel={null} onRemove={() => void removeQueueRow(row, refetch)} />
        ))}
      </div>
    </div>
  );
}
