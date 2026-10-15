/**
 * Stock accuracy — managers only (Graeme, 15 Oct 2026; Objective B).
 *
 * The running ("expected") stock for each ingredient — last real count +
 * deliveries − usage the app saw — and how every recent count compared with
 * what was expected at that moment. Gaps that are big or keep happening are
 * flagged: waste, miscounts, or usage the app doesn't see.
 *
 * The expected figure is NEVER shown at a station or on a stock-check screen
 * (blind counts: "I don't want people to just go 'yeah, that sounds right'").
 * Data: GET /api/stock-accuracy (manager+). docs/RUNNING_STOCK.md.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Variance {
  at: string;
  counted: number;
  expected: number;
  diff: number;
  pct: number | null;
  gap: number | null;
  receipts: number;
  usage: number;
}

interface AccuracyIngredient {
  id: number;
  name: string;
  unit: string;
  category: string | null;
  stockCheckEnabled: boolean;
  stockCheckFrequency: string;
  kanbanEnabled: boolean;
  coverage: "tracked" | "estimated" | "untracked";
  coverageLabel: string;
  expectedNow: null | {
    expected: number;
    basedOnCount: { qty: number; at: string };
    receiptsSince: number;
    usageSince: number;
    usageBySource: Array<{ source: string; label: string; qty: number }>;
  };
  usageInWindow: number;
  variances: Variance[];
  typicalGap: number | null;
  flags: Array<{ kind: string; message: string }>;
}

interface AccuracyResponse {
  generatedAt: string;
  days: number;
  ingredients: AccuracyIngredient[];
}

const WINDOWS = [14, 42, 84] as const;
type Filter = "flagged" | "all" | "never";

const fmt = (n: number) => String(Number(n.toFixed(2)));
const shortDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

function useStockAccuracy(days: number) {
  return useQuery<AccuracyResponse>({
    queryKey: ["stock-accuracy", days],
    staleTime: 60_000,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/stock-accuracy?days=${days}`, { credentials: "include" });
      if (r.status === 403) throw new Error("Stock accuracy is for managers and admins.");
      if (!r.ok) throw new Error(`Stock accuracy failed to load (${r.status})`);
      return r.json();
    },
  });
}

/** Diverging bars, one per count: up = more on the shelf than expected,
 *  down = less. Height = the gap as a share of what was being tracked
 *  (capped at 100%). Direction + colour + the hover text carry the sign. */
function GapTrend({ variances, unit }: { variances: Variance[]; unit: string }) {
  if (variances.length === 0) {
    return <p className="text-xs text-muted-foreground">No counts to compare yet.</p>;
  }
  const H = 22;
  const barW = 10;
  const gapPx = 4;
  const width = variances.length * (barW + gapPx);
  return (
    <svg
      viewBox={`0 0 ${width} ${H * 2 + 2}`}
      className="w-full max-w-[16rem] h-12"
      role="img"
      aria-label={`Last ${variances.length} counts against expected`}
    >
      <line x1={0} x2={width} y1={H + 1} y2={H + 1} className="stroke-border" strokeWidth={1} />
      {variances.map((v, i) => {
        const g = Math.max(-1, Math.min(1, v.gap ?? 0));
        const h = Math.max(2, Math.abs(g) * H);
        const up = g >= 0;
        const small = Math.abs(g) < 0.1;
        return (
          <g key={v.at}>
            <title>
              {`${shortDateTime(v.at)}: counted ${fmt(v.counted)} ${unit}, expected ${fmt(v.expected)} ${unit} (${v.diff >= 0 ? "+" : ""}${fmt(v.diff)})`}
            </title>
            {/* Generous hit target */}
            <rect x={i * (barW + gapPx) - 1} y={0} width={barW + 2} height={H * 2 + 2} fill="transparent" />
            <rect
              x={i * (barW + gapPx)}
              y={up ? H + 1 - h : H + 1}
              width={barW}
              height={h}
              rx={2}
              className={small ? "fill-muted-foreground/40" : up ? "fill-sky-500" : "fill-amber-500"}
            />
          </g>
        );
      })}
    </svg>
  );
}

function IngredientCard({ ing }: { ing: AccuracyIngredient }) {
  const exp = ing.expectedNow;
  const last = ing.variances[ing.variances.length - 1];
  const flagged = ing.flags.length > 0;
  return (
    <div className={cn(
      "rounded-2xl border bg-card p-5 flex flex-col gap-4 shadow-sm",
      flagged ? "border-amber-400/60" : "border-border",
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold leading-tight truncate" title={ing.name}>{ing.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {ing.stockCheckEnabled ? `Counted ${ing.stockCheckFrequency}` : "Not stock-checked"}
            {ing.kanbanEnabled ? " · kanban" : ""}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
            ing.coverage === "tracked" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
            ing.coverage === "estimated" && "bg-sky-500/10 text-sky-700 dark:text-sky-300",
            ing.coverage === "untracked" && "bg-muted text-muted-foreground",
          )}
          title={ing.coverageLabel}
        >
          {ing.coverage === "tracked" ? "Tracked" : ing.coverage === "estimated" ? "Partly tracked" : "Usage not tracked"}
        </span>
      </div>

      {exp ? (
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Expected now</p>
          <p className="text-3xl font-bold tabular-nums">
            {fmt(Math.max(0, exp.expected))} <span className="text-base font-medium text-muted-foreground">{ing.unit}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Counted {fmt(exp.basedOnCount.qty)} {ing.unit} on {shortDateTime(exp.basedOnCount.at)}
            {" · "}+{fmt(exp.receiptsSince)} delivered · −{fmt(exp.usageSince)} used
          </p>
          {exp.usageBySource.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              {exp.usageBySource.map(s => (
                <li key={s.source} className="flex justify-between gap-2">
                  <span className="truncate" title={s.label}>{s.label}</span>
                  <span className="tabular-nums shrink-0">{fmt(s.qty)} {ing.unit}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="rounded-xl bg-muted/50 p-3 text-sm">
          <p className="font-medium">Never counted</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {fmt(ing.usageInWindow)} {ing.unit} used in this period. Count it once and the app keeps an expected figure from then on.
          </p>
        </div>
      )}

      {ing.variances.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Last count vs expected</p>
              {last && (
                <p className="text-sm">
                  <span className="font-semibold tabular-nums">{fmt(last.counted)}</span>
                  <span className="text-muted-foreground"> counted · expected </span>
                  <span className="tabular-nums">{fmt(last.expected)}</span>
                  <span className={cn(
                    "ml-1 font-medium tabular-nums",
                    last.gap != null && Math.abs(last.gap) < 0.1 ? "text-muted-foreground" : last.diff < 0 ? "text-amber-700 dark:text-amber-300" : "text-sky-700 dark:text-sky-300",
                  )}>
                    ({last.diff >= 0 ? "+" : ""}{fmt(last.diff)}{last.pct != null ? `, ${last.pct >= 0 ? "+" : ""}${Math.round(last.pct * 100)}%` : ""})
                  </span>
                </p>
              )}
            </div>
            {ing.typicalGap != null && (
              <p className="text-xs text-muted-foreground text-right" title="Median gap between a count and what was expected, as a share of the expected stock or the usage in between (whichever is bigger).">
                Typically off by<br /><span className="text-sm font-semibold text-foreground">{Math.round(ing.typicalGap * 100)}%</span>
              </p>
            )}
          </div>
          <GapTrend variances={ing.variances} unit={ing.unit} />
          <p className="text-[11px] text-muted-foreground">
            Bars: <span className="text-sky-700 dark:text-sky-300">up = more than expected</span>, <span className="text-amber-700 dark:text-amber-300">down = less</span>. Hover for each count.
          </p>
        </div>
      )}

      {flagged ? (
        <ul className="space-y-1.5">
          {ing.flags.map(f => (
            <li key={f.kind} className="flex gap-2 text-sm text-amber-800 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
              <span>{f.message}</span>
            </li>
          ))}
        </ul>
      ) : ing.variances.length > 0 ? (
        <p className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="w-4 h-4" aria-hidden /> Counts match what was expected
        </p>
      ) : null}
    </div>
  );
}

function SummaryTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-3xl font-bold tabular-nums mt-1">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

export default function StockAccuracyPage() {
  const [days, setDays] = useState<number>(42);
  const [filter, setFilter] = useState<Filter>("flagged");
  const { data, isLoading, isFetching, error, refetch } = useStockAccuracy(days);

  const ingredients = data?.ingredients ?? [];
  const flagged = ingredients.filter(i => i.flags.length > 0);
  const never = ingredients.filter(i => !i.expectedNow && i.coverage !== "untracked");
  const shown = filter === "flagged" ? flagged : filter === "never" ? never : ingredients;

  const typical = useMemo(() => {
    const xs = ingredients.filter(i => i.variances.length >= 3 && i.typicalGap != null).map(i => i.typicalGap!).sort((a, b) => a - b);
    if (xs.length === 0) return null;
    const m = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
  }, [ingredients]);

  return (
    <div className="p-4 md:p-6 space-y-6 w-full">
      <PageHeader
        title="Stock accuracy"
        description="What the app expects each ingredient to be — last count + deliveries − usage — against real counts. Managers only; never shown at stations."
        action={
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 h-11 text-sm hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} /> Refresh
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {(["flagged", "all", "never"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "h-11 rounded-full px-4 text-sm font-medium border",
              filter === f ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted",
            )}
          >
            {f === "flagged" ? `Needs a look (${flagged.length})` : f === "all" ? `All (${ingredients.length})` : `Never counted (${never.length})`}
          </button>
        ))}
        <span className="mx-2 h-6 w-px bg-border hidden sm:block" />
        {WINDOWS.map(w => (
          <button
            key={w}
            onClick={() => setDays(w)}
            className={cn(
              "h-11 rounded-full px-4 text-sm border",
              days === w ? "bg-muted font-semibold border-foreground/30" : "border-border hover:bg-muted",
            )}
          >
            {w / 7} weeks
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Working out expected stock…</div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : "Couldn't load stock accuracy."}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <SummaryTile
              label="Typical gap"
              value={typical == null ? "—" : `${Math.round(typical * 100)}%`}
              sub="Median, ingredients with 3+ counts in this period"
            />
            <SummaryTile label="Need a look" value={String(flagged.length)} sub="Big or repeated gaps" />
            <SummaryTile label="Never counted" value={String(never.length)} sub="Used in recipes, no count to start from" />
          </div>

          <div className="flex gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
            <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
            <p className="max-w-prose">
              Usage the app sees: prep tins ticked, ingredients added at mixing and building, and recorded waste.
              Ingredients inside bases, sauces, dough and other sub-recipes are estimated from the batches made with them
              (“partly tracked”). Packaging and cleaning items aren’t used by recipes, so they have no expected figure.
            </p>
          </div>

          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {filter === "flagged" ? "Nothing flagged — counts are matching what was expected." : "Nothing to show."}
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
              {shown.map(ing => <IngredientCard key={ing.id} ing={ing} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
