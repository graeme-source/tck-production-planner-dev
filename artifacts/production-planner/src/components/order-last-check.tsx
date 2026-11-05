import {
  deliveredSinceLabel,
  expectedStockBasisLine,
  expectedStockHeadline,
  expectedStockTooltip,
  lastCheckValue,
  lastCheckWhen,
  orderingFromLabel,
  type ExpectedStock,
} from "@/lib/expected-stock-label";
import { Clock } from "lucide-react";

// A line nobody has counted today (Graeme, 5 Nov 2026): when it was last
// checked and what it came to are always on show, so anyone can decide whether
// it needs a new check. The order already uses it, with nothing to press. An
// item counted weekly orders from the expected figure, which says so here.

export function OrderLastCheck({ expected, unit, orderingFromIt }: {
  expected: ExpectedStock;
  unit: string;
  orderingFromIt: boolean;
}) {
  const delivered = deliveredSinceLabel(expected, unit);
  const orderingFrom = orderingFromIt ? orderingFromLabel(expected, unit) : null;
  return (
    <div className="flex flex-col items-end gap-1 mt-0.5 text-right">
      <div className="text-xs leading-tight">
        <span className="flex items-center justify-end gap-1 text-amber-700 dark:text-amber-400">
          <Clock className="w-3 h-3" /> Last check {lastCheckWhen(expected.basedOnCountAt)}
        </span>
        <span className="block text-sm font-bold">{lastCheckValue(expected, unit)}</span>
        {delivered && <span className="block text-muted-foreground">{delivered}</span>}
        {orderingFrom && <span className="block font-semibold">{orderingFrom}</span>}
      </div>
      {!orderingFromIt && (
        <span className="text-[10px] leading-tight text-sky-700 dark:text-sky-300" title={expectedStockTooltip(expected, unit)}>
          <span className="block font-semibold">{expectedStockHeadline(expected, unit)}</span>
          <span className="block text-muted-foreground">{expectedStockBasisLine(expected)}</span>
        </span>
      )}
    </div>
  );
}
