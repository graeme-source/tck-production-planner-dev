/**
 * The whole ad account for the period, in one big panel (Graeme, 12 Nov 2026:
 * "one big panel which shows the overall account KPIs … CPA, spend, ROAS and
 * reach, all blended from the whole account … include the colour coding").
 * Meta's own account row, so reach is de-duplicated across campaigns and
 * spend includes campaigns that are no longer live. Graded against the same
 * Ads targets as the cards.
 */
import { cn } from "@/lib/utils";
import { count, money, reachPctText, roasText, type AdFigures, type AdGrade } from "@/lib/ads-page";
import type { RoasShade } from "@/lib/ad-efficiency";

const onShade = (shade: RoasShade) => (shade.darkBackground ? "text-white" : "text-stone-900");

function Tile({ label, value, shade }: { label: string; value: string; shade?: RoasShade | null }) {
  return (
    <div
      className={cn("rounded-2xl px-4 py-4 lg:py-5 text-center flex flex-col items-center justify-center min-w-0",
        shade ? onShade(shade) : "bg-secondary/60 text-foreground")}
      style={shade ? { backgroundColor: shade.hex } : undefined}
    >
      <p className={cn("text-base lg:text-lg font-semibold", shade ? "opacity-90" : "text-muted-foreground")}>{label}</p>
      <p className="text-3xl xl:text-5xl font-display font-extrabold tabular-nums tracking-tight leading-tight">{value}</p>
    </div>
  );
}

export function AccountPanel({ figures, grade, periodLabel }: { figures: AdFigures; grade: AdGrade; periodLabel: string }) {
  return (
    <section aria-label="Whole account" className="rounded-3xl border-2 border-border bg-card shadow-sm overflow-hidden">
      <div
        className={cn("px-5 py-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1",
          grade.overall ? onShade(grade.overall) : "bg-secondary text-foreground")}
        style={grade.overall ? { backgroundColor: grade.overall.hex } : undefined}
      >
        <h2 className="text-xl lg:text-2xl font-display font-extrabold">Whole account</h2>
        <p className="text-sm font-semibold opacity-90">
          {periodLabel} · {count(figures.purchases)} result{figures.purchases === 1 ? "" : "s"} · {money(figures.purchaseValue)} in sales
          {grade.note ? ` · ${grade.note}` : ""}
        </p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-3">
        <Tile label="CPA" value={money(figures.costPerResult)} shade={grade.costPerResult} />
        <Tile label="Spend" value={money(figures.spend)} />
        <Tile label="ROAS" value={roasText(figures.roas)} shade={grade.roas} />
        <Tile label="Reach" value={reachPctText(figures.costPerReachPct)} shade={grade.costPerReach} />
      </div>
    </section>
  );
}
