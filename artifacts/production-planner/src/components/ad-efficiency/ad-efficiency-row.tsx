/**
 * Advertising efficiency — the ROAS row on the Numbers page's At a Glance
 * section (Graeme, 2026-10-11). Objective I (founder command centre).
 *
 * Three big cards — new-customer ROAS over the last 7 days and this month,
 * and ROAS on total sales over the last 30 days — each against a target,
 * coloured like the dashboard's KPI tiles (lib/station-kpi-bands.ts), with
 * a sparkline and the £ behind it. Then a "What to do" card following the
 * Hammersley rule. Maths: lib/ad-efficiency.ts (pure, tested). Figures:
 * the Numbers trend series by the day — the same data as Order Analysis.
 */
import { useId, useMemo, useState } from "react";
import { SpendContextNotes } from "@/components/sales-drivers/spend-context-notes";
import { ArrowDownRight, ArrowUpRight, HelpCircle, History, Megaphone, Minus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useSalesTrend } from "@/hooks/use-sales-trend";
import {
  adWindows, earliestDayNeeded, measureWindow, recommend, roasBand, roasShade, roasVerdict, rollingSeries, shadeAtRatio, ROAS_SHADE_ANCHORS, ROAS_SHADE_STEPS,
  spendSourceLine, type AdDay, type AdEfficiencySettings, type RecommendationTone, type SparkPoint,
} from "@/lib/ad-efficiency";
import { yesterdayLondon, type RoasResult, type RoasWindow } from "@/lib/roas";
import { BAND_HEADER_CLASS, BAND_TEXT_CLASS, type KpiBand } from "@/lib/station-kpi-bands";
import { useAdEfficiencySettings, useSpendSources } from "./api";
import { RoasTargetsButton } from "./targets-dialog";
import { RoasHistoryDialog } from "./roas-history-dialog";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

function windowLabel(w: RoasWindow): string {
  if (w.dayCount === 0) return "No complete days yet";
  const span = w.from === w.to
    ? dayLabel(w.from)
    : w.from.slice(5, 7) === w.to.slice(5, 7)
      ? `${Number(w.from.slice(8, 10))}–${dayLabel(w.to)}`
      : `${dayLabel(w.from)} – ${dayLabel(w.to)}`;
  return `${span} · ${w.dayCount} complete day${w.dayCount === 1 ? "" : "s"}`;
}

const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
const pctText = (n: number) => `${Math.round(n * 10) / 10}%`;

/** Sparkline stroke per band — the band's own colour. */
const SPARK_CLASS: Record<KpiBand, string> = {
  platinum: "text-teal-600",
  green: "text-[#7cb342]",
  amber: "text-yellow-500",
  red: "text-rose-600",
  neutral: "text-stone-400",
};

/** "Wed 8 Oct" for the scrub read-out. */
function scrubDayLabel(d: string): string {
  const dt = new Date(`${d}T12:00:00Z`);
  return dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" });
}

function Sparkline({ points, target, band, caption }: { points: SparkPoint[]; target: number; band: KpiBand; caption: string }) {
  const W = 300;
  const H = 56;
  // Hooks first — before the "not enough days" early return.
  const gradId = useId().replace(/:/g, "");
  // Scrub to read any day (Graeme, 2026-10-11): drag a finger along the line
  // or hover/click with a mouse — the nearest day shows its date and figure.
  const [hover, setHover] = useState<number | null>(null);
  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / (r.width || 1)));
    let i = Math.round(frac * (points.length - 1));
    // Snap to the nearest day that has a figure.
    if (points[i]?.percent == null) {
      for (let d = 1; d < points.length; d++) {
        if (points[i - d]?.percent != null) { i = i - d; break; }
        if (points[i + d]?.percent != null) { i = i + d; break; }
      }
    }
    setHover(points[i]?.percent != null ? i : null);
  };
  const values = points.map((p) => p.percent).filter((v): v is number => v != null);
  if (values.length < 2) {
    return <p className="text-xs text-muted-foreground h-14 flex items-center">Not enough days for a trend yet</p>;
  }
  const lo = Math.min(...values, target) * 0.95;
  const hi = Math.max(...values, target) * 1.05;
  const x = (i: number) => (points.length === 1 ? W : (i / (points.length - 1)) * W);
  const y = (v: number) => H - ((v - lo) / (hi - lo || 1)) * H;
  // Break the line at gaps ("—" days) rather than drawing through them.
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((p, i) => {
    if (p.percent == null) { if (current.length) segments.push(current.join(" ")); current = []; return; }
    current.push(`${x(i).toFixed(1)},${y(p.percent).toFixed(1)}`);
  });
  if (current.length) segments.push(current.join(" "));
  const lastIdx = points.map((p) => p.percent != null).lastIndexOf(true);
  const last = points[lastIdx]!;
  // Colour the line by where it sits against the target, like the green
  // shading in Graeme's sheet (2026-10-11): green on/above target, yellow in
  // the "just under" band, red below that. A hard-stop vertical gradient in
  // the chart's own coordinates, so each stretch of the line takes the colour
  // of its height.
  // Since 2026-10-12 the line runs through the same 31 shades as the card
  // header — each height takes the shade for that % of target.
  const toOffset = (v: number) => Math.min(1, Math.max(0, y(v) / H));
  const lowRatio = ROAS_SHADE_ANCHORS[0]!.ratio;
  const highRatio = ROAS_SHADE_ANCHORS[ROAS_SHADE_ANCHORS.length - 1]!.ratio;
  const stops = Array.from({ length: ROAS_SHADE_STEPS + 1 }, (_, k) => {
    const ratio = highRatio - (k / ROAS_SHADE_STEPS) * (highRatio - lowRatio);
    return { offset: toOffset(target * ratio), hex: shadeAtRatio(ratio).hex };
  });
  const dotHex = shadeAtRatio(last.percent! / target).hex;
  return (
    <figure className="space-y-1">
      <div className="relative" data-no-swipe>
      {hover != null && points[hover]?.percent != null && (
        <div
          className={cn("absolute -top-7 z-10 pointer-events-none whitespace-nowrap rounded-md bg-foreground text-background text-xs font-semibold px-2 py-0.5 tabular-nums",
            hover / Math.max(1, points.length - 1) > 0.7 ? "-translate-x-full" : hover / Math.max(1, points.length - 1) < 0.3 ? "" : "-translate-x-1/2")}
          style={{ left: `${(hover / Math.max(1, points.length - 1)) * 100}%` }}
        >
          {scrubDayLabel(points[hover]!.date)} · {Math.round(points[hover]!.percent!)}%
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cn("w-full h-14 overflow-visible cursor-crosshair touch-pan-y", SPARK_CLASS[band])} role="img"
        onPointerDown={pick} onPointerMove={pick} onPointerLeave={(e) => { if (e.pointerType === "mouse") setHover(null); }}
        aria-label={`${caption}: from ${values[0]}% to ${values[values.length - 1]}%, target ${target}%`}>
        <defs>
          <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={H}>
            {stops.map((st, k) => <stop key={k} offset={st.offset} stopColor={st.hex} />)}
          </linearGradient>
        </defs>
        <line x1={0} x2={W} y1={y(target)} y2={y(target)} className="stroke-muted-foreground/50" strokeWidth={1.5} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
        {segments.map((s, i) => (
          <polyline key={i} points={s} fill="none" stroke={`url(#${gradId})`} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        ))}
        <circle cx={x(lastIdx)} cy={y(last.percent!)} r={3.5} fill={dotHex} />
        {hover != null && points[hover]?.percent != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} className="stroke-foreground/40" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <circle cx={x(hover)} cy={y(points[hover]!.percent!)} r={4} className="fill-background" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      </div>
      <figcaption className="text-xs text-muted-foreground flex justify-between gap-2">
        <span>{caption}</span>
        <span className="whitespace-nowrap">- - target</span>
      </figcaption>
    </figure>
  );
}

/** Each of the last 7 days ON ITS OWN, newest first — that day's spend
 *  against that day's sales, not the rolling figure as it stood that day
 *  (Graeme, 2026-10-13: "the individual squares are just the new customer
 *  ROAS for that particular day only, not the average on that day"). The big
 *  number above stays the window's figure; the line still shows the rolling
 *  figure across 30 days on hover/drag. Coloured against the card's target. */
function LastSevenDays({ points, dayOnly, target, caption }: {
  /** The card's rolling figure as it stood each day — the coloured column. */
  points: SparkPoint[];
  /** Each day on its own (that day's sales ÷ that day's spend), shown plain
   *  to the left of the rolling figure, like Graeme's sheet (2026-10-14). */
  dayOnly?: SparkPoint[];
  target: number;
  caption: string;
}) {
  const last = points.slice(-7);
  if (last.length === 0) return null;
  const dayBy = new Map((dayOnly ?? []).map(p => [p.date, p.percent]));
  const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v)}%`);
  return (
    <div className="space-y-px" aria-label={`Last 7 days — ${caption}`}>
      <div className="flex items-center justify-between gap-2 px-1 pb-0.5 text-xs text-muted-foreground">
        <span>{dayOnly ? "Last 7 days" : caption}</span>
        {dayOnly && (
          <span className="flex items-center gap-2">
            <span className="w-14 text-right">That day</span>
            <span className="w-14 text-right">{caption}</span>
          </span>
        )}
      </div>
      {[...last].reverse().map(p => {
        const shade = roasShade(p.percent, target);
        const d = new Date(`${p.date}T12:00:00Z`);
        return (
          <div key={p.date} className="flex items-center justify-between gap-2 px-1 text-[13px] leading-5">
            <span className="text-muted-foreground">{d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" })}</span>
            <span className="flex items-center gap-2">
              {dayOnly && <span className="w-14 text-right tabular-nums text-foreground">{pct(dayBy.get(p.date))}</span>}
              <span
                className={cn("w-14 text-right rounded px-1.5 font-bold tabular-nums", !shade && "bg-secondary text-muted-foreground", shade && (shade.darkBackground ? "text-white" : "text-stone-900"))}
                style={shade ? { backgroundColor: shade.hex } : undefined}
              >{pct(p.percent)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RoasCard({
  title, qualifier, result, target, settings, spark, daily, dailyCaption, sparkCaption, window: win, revenueLabel, onShowHistory,
}: {
  title: string;
  /** The window, under the title: "Last 7 days". */
  qualifier: string;
  result: RoasResult;
  target: number;
  settings: AdEfficiencySettings;
  spark: SparkPoint[];
  /** Each day's own figure (a 1-day window) for the 7-day list; leave out
   *  to list the rolling figure as it stood each day instead (the 30-day
   *  cards — Graeme, 2026-10-14: "change these two panels back to
   *  averages… leaving the 7-day one showing… each of those days"). */
  daily?: SparkPoint[];
  /** Caption over the list when it shows the rolling figure. */
  dailyCaption?: string;
  /** Shows a "Last 90 days" button that opens the full history. */
  onShowHistory?: () => void;
  sparkCaption: string;
  window: RoasWindow;
  revenueLabel: string;
}) {
  const shown = result.available ? result.percent : null;
  const band = roasBand(shown, target, settings.amberWidthPct);
  // Header shade: one of 31 from dark red to deep platinum, so the colour
  // says HOW far above or below target (Graeme, 2026-10-12).
  const shade = roasShade(shown, target);
  return (
    <div className="glass-panel rounded-2xl overflow-hidden flex flex-col">
      <div
        className={cn("px-5 py-3", shade ? (shade.darkBackground ? "text-white" : "text-stone-900") : [BAND_HEADER_CLASS[band], BAND_TEXT_CLASS[band]])}
        style={shade ? { backgroundColor: shade.hex } : undefined}
      >
        <p className="text-lg font-display font-bold leading-tight">{title}</p>
        {/* The window lives in the title ("7-day new customer ROAS") so it
            reads at a glance (Graeme, 2026-10-11); this line is the verdict. */}
        <p className="text-sm font-semibold opacity-90">{roasVerdict(shown, target, settings.amberWidthPct)}</p>
      </div>
      <div className="p-5 flex flex-col gap-4 flex-1">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            {result.available ? (
              <>
                <p className="text-5xl font-display font-bold tabular-nums leading-none">{result.percent}%</p>
                <p className="text-sm text-muted-foreground mt-2">{Math.round((result.percent / target) * 100)}% of target</p>
              </>
            ) : (
              <>
                <p className="text-5xl font-display font-bold text-muted-foreground leading-none">—</p>
                <p className="text-sm text-muted-foreground mt-2">{result.reason}</p>
              </>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Target</p>
            <p className="text-2xl font-display font-bold tabular-nums">{pctText(target)}</p>
          </div>
        </div>
        <Sparkline points={spark} target={target} band={band} caption={sparkCaption} />
        <LastSevenDays points={spark} dayOnly={daily} target={target} caption={dailyCaption ?? "Average as it stood each day"} />
        {onShowHistory && (
          <button
            type="button"
            onClick={onShowHistory}
            className="self-start inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-secondary"
          >
            <History className="w-3.5 h-3.5" /> Last 90 days
          </button>
        )}
        {result.available && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-secondary/50 px-3 py-2">
              <p className="text-xs text-muted-foreground">{revenueLabel}</p>
              <p className="text-lg font-semibold tabular-nums">{gbp(result.revenue)}</p>
            </div>
            <div className="rounded-xl bg-secondary/50 px-3 py-2">
              <p className="text-xs text-muted-foreground">Ad spend</p>
              <p className="text-lg font-semibold tabular-nums">{gbp(result.spend)}</p>
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-auto">{windowLabel(win)}</p>
      </div>
    </div>
  );
}

const TONE: Record<RecommendationTone, { icon: React.ElementType; border: string; chip: string; label: string }> = {
  raise: { icon: ArrowUpRight, border: "border-l-[#7cb342]", chip: "bg-[#7cb342]/15 text-[#558b2f]", label: "Raise spend" },
  hold: { icon: Minus, border: "border-l-sky-500", chip: "bg-sky-100 text-sky-700", label: "Hold steady" },
  trim: { icon: ArrowDownRight, border: "border-l-rose-600", chip: "bg-rose-100 text-rose-600", label: "Trim spend" },
  unknown: { icon: HelpCircle, border: "border-l-stone-400", chip: "bg-stone-100 text-stone-600", label: "Not enough data" },
};

export function AdEfficiencyRow() {
  const lastDay = yesterdayLondon(Date.now());
  const from = earliestDayNeeded(lastDay);
  const trend = useSalesTrend(from, lastDay, "day");
  const settingsQ = useAdEfficiencySettings();
  const [historyOpen, setHistoryOpen] = useState(false);
  const windows = useMemo(() => adWindows(lastDay), [lastDay]);
  const sources = useSpendSources(windows.last30.from, lastDay);

  const days: AdDay[] = useMemo(
    () => (trend.data?.buckets ?? []).map((b) => ({
      date: b.key,
      revenue: b.revenue,
      newCustomerRevenue: b.newCustomerRevenue,
      spend: b.adSpend,
    })),
    [trend.data],
  );

  const settings = settingsQ.data?.settings;
  const view = useMemo(() => {
    if (!settings || !trend.data) return null;
    return {
      last7: measureWindow(days, windows.last7, "newCustomer"),
      // Rolling 30 days, not month-to-date (Graeme, 2026-10-11).
      nc30: measureWindow(days, windows.last30, "newCustomer"),
      total30: measureWindow(days, windows.last30, "total"),
      spark7: rollingSeries(days, "newCustomer", 7, lastDay),
      sparkNc30: rollingSeries(days, "newCustomer", 30, lastDay),
      spark30: rollingSeries(days, "total", 30, lastDay),
      dailyNc: rollingSeries(days, "newCustomer", 1, lastDay, 7),
      advice: recommend({ days, windows, settings }),
    };
  }, [days, windows, settings, trend.data, lastDay]);

  const sourceLine = useMemo(
    () => spendSourceLine(sources.data?.days ?? [], sources.data?.google?.firstDate ?? null),
    [sources.data],
  );

  const failed = trend.error || settingsQ.error;

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-base font-display font-bold flex items-center gap-2">
          <Megaphone className="w-5 h-5 text-pink-500" /> Advertising efficiency
        </h3>
        <RoasTargetsButton />
      </div>

      {failed ? (
        <p className="glass-panel rounded-2xl p-5 text-destructive text-sm">
          Couldn't load the ROAS figures — {(failed as Error).message}. Try Refresh.
        </p>
      ) : !view || !settings ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-80 rounded-2xl" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <RoasCard
              title="7-day new customer ROAS"
              qualifier="Last 7 days"
              result={view.last7}
              target={settings.ncRoas7dTargetPct}
              settings={settings}
              spark={view.spark7}
              daily={view.dailyNc}
              dailyCaption="7-day avg"
              onShowHistory={() => setHistoryOpen(true)}
              sparkCaption="Rolling 7-day, last 30 days"
              window={windows.last7}
              revenueLabel="New customers"
            />
            <RoasCard
              title="30-day new customer ROAS"
              qualifier="Last 30 days"
              result={view.nc30}
              target={settings.ncRoasMtdTargetPct}
              settings={settings}
              spark={view.sparkNc30}
              dailyCaption="30-day average as it stood each day"
              sparkCaption="Rolling 30-day, last 30 days"
              window={windows.last30}
              revenueLabel="New customers"
            />
            <RoasCard
              title="30-day ROAS on total sales"
              qualifier="Last 30 days"
              result={view.total30}
              target={settings.totalRoas30dTargetPct}
              settings={settings}
              spark={view.spark30}
              dailyCaption="30-day average as it stood each day"
              sparkCaption="Rolling 30-day, last 30 days"
              window={windows.last30}
              revenueLabel="Total sales"
            />
          </div>
          <AdviceCard advice={view.advice} sourceLine={sourceLine} />
          {/* Delivery wait, emails and site changes in the same 7 days —
              context for the advice, never an override (2026-10-16). */}
          <SpendContextNotes from={windows.last7.from} to={windows.last7.to} />
          {historyOpen && (
            <RoasHistoryDialog lastDay={lastDay} target={settings.ncRoas7dTargetPct} onClose={() => setHistoryOpen(false)} />
          )}
        </>
      )}
    </div>
  );
}

function AdviceCard({ advice, sourceLine }: { advice: ReturnType<typeof recommend>; sourceLine: string }) {
  const tone = TONE[advice.tone];
  const Icon = tone.icon;
  return (
    <div className={cn("glass-panel rounded-2xl p-5 border-l-8 space-y-3", tone.border)}>
      <div className="flex items-start gap-4">
        <div className={cn("p-3 rounded-xl shrink-0", tone.chip)}>
          <Icon className="w-6 h-6" />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">What to do · {tone.label}</p>
          <p className="text-lg font-semibold leading-snug">{advice.headline}</p>
        </div>
      </div>
      {advice.notes.length > 0 && (
        <ul className="space-y-1.5 pl-1">
          {advice.notes.map((n) => (
            <li key={n} className="text-sm flex gap-2"><span className="text-muted-foreground">•</span><span>{n}</span></li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Based on the 7-day new-customer ROAS. All three cards use complete days up to yesterday — today is still running. {sourceLine}
      </p>
    </div>
  );
}
