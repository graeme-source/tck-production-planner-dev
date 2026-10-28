/**
 * Price and margin at the foot of a recipe's Ingredients tab (Graeme,
 * 28 Oct 2026: "tweak the numbers, tweak the price, and see the margin all
 * from the same place"). The RRP box is the same form field as the one on
 * Details, so changing either changes both; the margin and pack cost update
 * on every keystroke, coloured like the Recipes table's GP margin column.
 * Saved with the recipe's Save button, like every other field. Objective G.
 */
import { cn } from "@/lib/utils";
import {
  livePackMargin, marginTone, rrpForMargin, MARGIN_FLOOR_PERCENT, MARGIN_TARGET_PERCENT,
} from "@/lib/recipe-line-cost";

const TONE_CLASS = {
  good: "bg-green-100 text-green-700 border-green-300 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800",
  ok: "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
  bad: "bg-red-100 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800",
} as const;

const money = (n: number) => `£${n.toFixed(2)}`;

export function MarginStrip({ costPerPortion, packSize, packagingCost, labourCost, rrp, onRrpChange }: {
  /** Ingredient cost of one portion, from the lines; null when nothing is costed. */
  costPerPortion: number | null;
  packSize: unknown;
  packagingCost: unknown;
  labourCost: unknown;
  rrp: unknown;
  onRrpChange: (value: string) => void;
}) {
  const ps = Number(packSize) || 1;
  const overhead = (Number(packagingCost) || 0) + (Number(labourCost) || 0);
  const { packCost, margin } = livePackMargin({ costPerPortion: costPerPortion ?? 0, packSize, packagingCost, labourCost, rrp });
  const tone = marginTone(margin);
  const priceFor = [MARGIN_TARGET_PERCENT, MARGIN_FLOOR_PERCENT].map(m => ({ m, price: rrpForMargin(packCost, m) }));

  return (
    <div className="px-4 py-4 border-t border-border bg-secondary/20 rounded-b-2xl space-y-3" data-testid="recipe-margin-strip">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:items-stretch">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">RRP per pack</span>
          <span className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg text-muted-foreground">£</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={rrp == null ? "" : String(rrp)}
              onChange={e => onRrpChange(e.target.value)}
              placeholder="0.00"
              aria-label="RRP per pack"
              className="w-full h-14 rounded-xl border-2 border-border bg-card pl-8 pr-3 text-2xl font-bold tabular-nums outline-none focus:border-primary"
              data-testid="margin-strip-rrp"
            />
          </span>
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pack cost</span>
          <span className="h-14 flex items-center text-2xl font-bold tabular-nums">{money(packCost)}</span>
          <span className="text-xs text-muted-foreground">
            {ps} portion{ps !== 1 ? "s" : ""}{overhead > 0 ? ` + ${money(overhead)} packaging & labour` : ""}
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">GP margin</span>
          {tone ? (
            <span className={cn("h-14 rounded-xl border-2 flex items-center justify-center text-2xl font-bold tabular-nums", TONE_CLASS[tone])} data-testid="margin-strip-gpm">
              {margin!.toFixed(1)}%
            </span>
          ) : (
            <span className="h-14 rounded-xl border-2 border-dashed border-border flex items-center justify-center text-base text-muted-foreground">
              Set an RRP
            </span>
          )}
          {margin != null && (
            <span className="text-xs text-muted-foreground">{money(Number(rrp) - packCost)} gross profit a pack</span>
          )}
        </div>
      </div>

      {packCost > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Set the RRP for a margin of</span>
          {priceFor.map(({ m, price }) => (
            <button
              key={m}
              type="button"
              onClick={() => onRrpChange(price.toFixed(2))}
              className={cn("min-h-11 px-4 rounded-xl border-2 font-bold tabular-nums transition-colors hover:brightness-95", TONE_CLASS[marginTone(m)!])}
              title={`Set the RRP to ${money(price)} — you can still type over it`}
              data-testid={`margin-strip-set-${m}`}
            >
              {m}% → {money(price)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
