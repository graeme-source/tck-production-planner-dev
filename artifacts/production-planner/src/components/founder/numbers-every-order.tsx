// "Every order" on Numbers (Graeme, 27 Nov 2026; Objective I): the same
// panel as Finance → Profit tracker, duplicated onto Numbers in place of the
// old Custom Tag Panels, for Numbers' own period. Same component and same
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

const MAX_DAYS = 93;

function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export function NumbersEveryOrder({ from, to, empty }: { from: string; to: string; empty?: boolean }) {
  const { canNumbers } = useFounderArea();
  const tooLong = daysInclusive(from, to) > MAX_DAYS;
  const { data, isLoading, error } = useQuery({
    queryKey: ["pnl-tracker-predict", from, to],
    queryFn: () => fetchPrediction(from, to),
    staleTime: 5 * 60 * 1000,
    enabled: canNumbers && !empty && !tooLong,
    retry: false,
  });

  if (!canNumbers || empty) return null;
  if (tooLong) {
    return (
      <div className="glass-panel rounded-2xl p-5">
        <h3 className="text-base font-display font-bold">Every order</h3>
        <p className="text-sm text-muted-foreground">Pick 3 months or less to see every order costed.</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="glass-panel rounded-2xl p-5">
        <h3 className="text-base font-display font-bold">Every order</h3>
        <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Couldn't cost the orders"}</p>
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="glass-panel rounded-2xl p-5 space-y-2">
        <Skeleton className="h-6 w-40" />
        {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}
      </div>
    );
  }
  return <OrderAnalysis data={data} />;
}
