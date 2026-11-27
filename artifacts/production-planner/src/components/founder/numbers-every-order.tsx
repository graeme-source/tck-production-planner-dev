// "Every order" on Numbers (Graeme, 27 Nov 2026; Objective I): the same
// panel as Finance → Profit tracker, duplicated onto Numbers in place of the
// old Custom Tag Panels, with its own period (opens on today). Same component and same
// data, so a change to one shows on both.
//
// The profit tracker costs every order one by one, so the server takes at
// most 93 days; a longer Numbers period gets a short note instead. Anyone
// who can open Numbers sees it (Graeme, 27 Nov 2026: everything on Numbers
// is for whoever holds the Numbers grant) — GET /api/pnl-tracker/predict
// takes the Numbers grant; the rest of the tracker stays founder only.
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { useFounderArea } from "@/hooks/use-founder-area";
import { fetchPrediction } from "./profit-tracker-api";
import { OrderAnalysis } from "./order-analysis";
import { PeriodPicker, usePeriodChoice } from "@/components/period-picker";

const MAX_DAYS = 93;

function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

// Its own period, starting on TODAY every time the page opens (Graeme, 27 Nov
// 2026: "we're always looking at the most recent orders that have come in by
// default") — Numbers' period above doesn't change it; only this panel's own
// picker does.
export function NumbersEveryOrder() {
  const { canNumbers } = useFounderArea();
  const { periodId, period, todayStr, onPreset, onDate } = usePeriodChoice("today");
  const { from, to, empty } = period;
  const picker = (
    <div className="glass-panel rounded-2xl px-4 py-3">
      <PeriodPicker periodId={periodId} period={period} todayStr={todayStr} onPreset={onPreset} onDate={onDate}
        note="Every order has its own dates — it always opens on today." />
    </div>
  );
  const tooLong = daysInclusive(from, to) > MAX_DAYS;
  const { data, isLoading, error } = useQuery({
    queryKey: ["pnl-tracker-predict", from, to],
    queryFn: () => fetchPrediction(from, to),
    staleTime: 5 * 60 * 1000,
    enabled: canNumbers && !empty && !tooLong,
    retry: false,
  });

  if (!canNumbers) return null;
  if (empty) {
    return (
      <div className="space-y-3">{picker}<div className="glass-panel rounded-2xl p-5">
        <h3 className="text-base font-display font-bold">Every order</h3>
        <p className="text-sm text-muted-foreground">No days in this period yet.</p>
      </div></div>
    );
  }
  if (tooLong) {
    return (
      <div className="space-y-3">{picker}<div className="glass-panel rounded-2xl p-5">
        <h3 className="text-base font-display font-bold">Every order</h3>
        <p className="text-sm text-muted-foreground">Pick 3 months or less to see every order costed.</p>
      </div></div>
    );
  }
  if (error) {
    return (
      <div className="space-y-3">{picker}<div className="glass-panel rounded-2xl p-5">
        <h3 className="text-base font-display font-bold">Every order</h3>
        <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Couldn't cost the orders"}</p>
      </div></div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="space-y-3">{picker}<div className="glass-panel rounded-2xl p-5 space-y-2">
        <Skeleton className="h-6 w-40" />
        {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}
      </div></div>
    );
  }
  return <div className="space-y-3">{picker}<OrderAnalysis data={data} /></div>;
}
