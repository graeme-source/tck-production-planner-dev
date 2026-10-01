import { AlertTriangle, ArrowRight } from "lucide-react";
import type { TopUpPlan, TopUpSuggestion } from "@/lib/minimum-order";

// Amber notice on an Orders-page supplier card whose draft order is under the
// supplier's minimum order value (Graeme, 2026-10-01 — Objective C). Lists
// items on other suppliers' orders that this supplier also sells; NOTHING
// moves until the person taps "Move to <supplier>" on a row.

/** £75 / £75.50 — whole pounds without the pence. */
export function formatMinimum(n: number): string {
  return Number.isInteger(n) ? `£${n}` : `£${n.toFixed(2)}`;
}
const money = (n: number) => `£${n.toFixed(2)}`;

function extraCostText(s: TopUpSuggestion): string {
  if (!s.priceConfirmed) return `price here not saved — using the ${s.fromSupplierName} price`;
  if (Math.abs(s.extraCost) < 0.005) return `same price as at ${s.fromSupplierName}`;
  return s.extraCost > 0
    ? `${money(s.extraCost)} more than at ${s.fromSupplierName}`
    : `${money(-s.extraCost)} less than at ${s.fromSupplierName}`;
}

export function MinimumOrderNotice({
  supplierName,
  minimum,
  value,
  unconfirmedCount,
  plan,
  onMove,
}: {
  supplierName: string;
  minimum: number;
  value: number;
  /** Lines on this order priced with a fallback (this supplier's price not saved). */
  unconfirmedCount: number;
  plan: TopUpPlan;
  onMove: (s: TopUpSuggestion) => void;
}) {
  const possessive = supplierName.endsWith("s") ? `${supplierName}'` : `${supplierName}'s`;
  const { suggestions } = plan;
  const leftShort = plan.closesGap
    ? 0
    : Math.max(0, plan.gap - suggestions.reduce((sum, s) => sum + s.addedValue, 0));

  return (
    <div className="mx-4 mb-4 rounded-xl border-2 border-amber-500/50 bg-amber-500/10 p-4 space-y-3" data-testid="minimum-order-notice">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="font-semibold text-amber-900 dark:text-amber-200">
            {money(value)} — {money(plan.gap)} under {possessive} {formatMinimum(minimum)} minimum
          </p>
          <p className="text-sm text-amber-900/80 dark:text-amber-200/80 mt-0.5">
            This order doesn&rsquo;t meet the minimum.
            {suggestions.length > 0
              ? ` Do you want to move something from another supplier's order onto this one to reach it?`
              : ` Nothing on today's other orders is also sold by ${supplierName} — add items, or order anyway if they'll still deliver.`}
          </p>
          {unconfirmedCount > 0 && (
            <p className="text-xs text-amber-900/70 dark:text-amber-200/70 mt-1">
              Includes {unconfirmedCount} item{unconfirmedCount === 1 ? "" : "s"} whose {supplierName} price isn&rsquo;t saved — priced at the usual supplier&rsquo;s price.
            </p>
          )}
        </div>
      </div>

      {suggestions.length > 0 && (
        <div className="space-y-2">
          {suggestions.map(s => (
            <div
              key={`${s.fromSupplierId}-${s.ingredientId}`}
              className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-border bg-card p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium leading-snug">
                  Move {s.ingredientName} &times;{s.packs} from {s.fromSupplierName}
                  <ArrowRight className="inline w-4 h-4 mx-1 -mt-0.5 text-muted-foreground" />
                  <span className="font-semibold">+{money(s.addedValue)} here</span>
                </p>
                <p className={s.priceConfirmed ? "text-sm text-muted-foreground" : "text-sm text-amber-700 dark:text-amber-400"}>
                  ({extraCostText(s)})
                </p>
                {s.leavesSourceUnderMinimum && s.sourceMinimum != null && (
                  <p className="text-sm text-amber-700 dark:text-amber-400 font-medium">
                    This would put {s.fromSupplierName} under its {formatMinimum(s.sourceMinimum)} minimum.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onMove(s)}
                className="min-h-[44px] px-4 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 transition-colors shrink-0"
              >
                Move to {supplierName}
              </button>
            </div>
          ))}
          {plan.closesGap && suggestions.length > 1 && (
            <p className="text-xs text-amber-900/80 dark:text-amber-200/80">
              Moving all {suggestions.length} reaches the minimum
              {plan.totalExtraCost > 0.005 ? ` for ${money(plan.totalExtraCost)} extra overall.` : "."}
            </p>
          )}
          {!plan.closesGap && (
            <p className="text-xs text-amber-900/80 dark:text-amber-200/80">
              Even moving all of these leaves the order {money(leftShort)} short.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
