import { Button } from "@/components/ui/button";
import {
  deliveredSinceLabel,
  expectedStockBasisLine,
  expectedStockHeadline,
  expectedStockTooltip,
  lastCheckValue,
  lastCheckWhen,
  stockFromLastCheck,
  type ExpectedStock,
} from "@/lib/expected-stock-label";
import { CheckCircle2, Clock, History } from "lucide-react";

// A line nobody has counted today (Graeme, 5 Nov 2026): when it was last
// checked and what it came to are always on show, and the order can be worked
// out from that instead of the expected figure, e.g. when there's no production
// tomorrow and nothing has moved. It never records a stock check.

export function OrderLastCheck({ expected, unit, using, onUse, onStopUsing }: {
  expected: ExpectedStock;
  unit: string;
  using: boolean;
  onUse: () => void;
  onStopUsing: () => void;
}) {
  const delivered = deliveredSinceLabel(expected, unit);
  return (
    <div className="flex flex-col items-end gap-1 mt-0.5 text-right">
      <div className="text-xs leading-tight">
        <span className="flex items-center justify-end gap-1 text-amber-700 dark:text-amber-400">
          <Clock className="w-3 h-3" /> Last check {lastCheckWhen(expected.basedOnCountAt)}
        </span>
        <span className="block text-sm font-bold">{lastCheckValue(expected, unit)}</span>
        {delivered && <span className="block text-muted-foreground">{delivered}</span>}
      </div>
      {using ? (
        <>
          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> Ordering from {Number(stockFromLastCheck(expected).toFixed(2))} {unit}
          </span>
          <Button type="button" variant="ghost" size="sm" className="h-auto min-h-[32px] px-2 text-xs" onClick={onStopUsing}>
            Use expected instead
          </Button>
        </>
      ) : (
        <>
          <Button type="button" variant="outline" size="sm" className="min-h-[40px]" onClick={onUse}>
            <History className="w-4 h-4 mr-1" /> Use last check
          </Button>
          <span className="text-[10px] leading-tight text-sky-700 dark:text-sky-300" title={expectedStockTooltip(expected, unit)}>
            <span className="block font-semibold">{expectedStockHeadline(expected, unit)}</span>
            <span className="block text-muted-foreground">{expectedStockBasisLine(expected)}</span>
          </span>
        </>
      )}
    </div>
  );
}
