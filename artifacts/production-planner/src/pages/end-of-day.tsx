/**
 * End-of-day meeting — the numbers reviewed before everyone goes home
 * (Graeme, 2026-09-17; improvements completed added 2026-09-18).
 *
 * The morning meeting asks "how did yesterday go?". This asks "how did TODAY
 * go?", while the people who can explain the number are still on site. Same
 * KPIs, same server-side helpers — deliberately not re-derived here,
 * because a second way of working out a rate is how the meeting and the
 * Analytics page came to disagree once before.
 *
 * Kept deliberately bare: four numbers, big enough to read from across the
 * room, and nothing else to click.
 */
import { useQuery } from "@tanstack/react-query";
import { Loader2, Hammer, PackageCheck, AlertTriangle, Trophy } from "lucide-react";
import { formatQualityRejects } from "@/lib/quality-rejects";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface EndOfDay {
  date: string;
  hasPlan: boolean;
  builder: { batchesPerHour: number | null; totalBatches: number; activeMinutes: number };
  packing: { boxesPerHour: number | null; totalBoxes: number; activeMinutes: number };
  wonkies: { count: number; batchesTarget: number };
  /** Thrown away — a separate figure from wonkies. Optional so a cached
   *  older server payload still renders (read as 0). */
  dogBins?: { count: number };
  /** Completed improvements only — done work bucketed by when it was marked
   *  done, never ideas. 0 is a real zero; null means the lookup failed.
   *  Optional so a cached older server payload doesn't crash the page. */
  improvements?: { completed: number | null };
}

const hours = (mins: number) => (mins / 60).toFixed(1);

function KpiCard({ label, value, unit, second, sub, icon: Icon, tone }: {
  label: string;
  value: string;
  unit?: string;
  /** A second figure on the same line, e.g. dog bins beside wonkies. */
  second?: { value: string; unit: string };
  sub: string;
  icon: typeof Hammer;
  tone: "green" | "blue" | "amber" | "violet";
}) {
  const tones = {
    green: "border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300",
    blue: "border-blue-300 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300",
    amber: "border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300",
    violet: "border-violet-300 dark:border-violet-800 bg-violet-50/60 dark:bg-violet-950/20 text-violet-700 dark:text-violet-300",
  } as const;
  return (
    <div className={cn("rounded-3xl border-2 p-6 sm:p-8 flex flex-col gap-2", tones[tone])}>
      <div className="flex items-center gap-2.5">
        <Icon className="w-6 h-6 flex-shrink-0" />
        <h2 className="text-xl sm:text-2xl font-bold leading-tight">{label}</h2>
      </div>
      <p className="flex items-baseline gap-2 text-foreground">
        <span className="text-6xl sm:text-7xl font-extrabold tabular-nums leading-none">{value}</span>
        {unit && <span className="text-xl sm:text-2xl font-semibold text-muted-foreground">{unit}</span>}
        {second && (
          <>
            <span className="text-3xl sm:text-4xl font-light text-muted-foreground px-1">·</span>
            <span className="text-6xl sm:text-7xl font-extrabold tabular-nums leading-none">{second.value}</span>
            <span className="text-xl sm:text-2xl font-semibold text-muted-foreground">{second.unit}</span>
          </>
        )}
      </p>
      <p className="text-base text-muted-foreground">{sub}</p>
    </div>
  );
}

export default function EndOfDayMeeting() {
  const { data, isLoading, error } = useQuery<EndOfDay>({
    queryKey: ["end-of-day"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/end-of-day`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't load today's numbers");
      return res.json();
    },
    // The day is still running — keep it fresh without hammering Shopify.
    refetchInterval: 2 * 60 * 1000,
  });

  if (isLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  }
  if (error || !data) {
    return (
      <div className="p-6 rounded-2xl bg-destructive/10 text-destructive text-lg font-semibold">
        {error instanceof Error ? error.message : "Couldn't load today's numbers."}
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-10">
      <div>
        <h1 className="text-3xl sm:text-4xl font-bold">End-of-day meeting</h1>
        <p className="text-lg text-muted-foreground mt-1">
          How today went — {format(parseISO(data.date), "EEEE d MMMM")}
        </p>
      </div>

      {!data.hasPlan && (
        <p className="rounded-2xl border-2 border-border bg-secondary/30 px-5 py-4 text-base text-muted-foreground">
          No production plan for today, so there are no quality rejects to count. The rates below still read from what was actually built and packed.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <KpiCard
          label="TCK run rate — batches per hour"
          icon={Hammer}
          tone="green"
          value={data.builder.batchesPerHour == null ? "—" : data.builder.batchesPerHour.toFixed(1)}
          unit={data.builder.batchesPerHour == null ? undefined : "per hour"}
          sub={data.builder.batchesPerHour == null
            ? "Nothing built yet today."
            : `${data.builder.totalBatches} batches over ${hours(data.builder.activeMinutes)} hours on the line`}
        />
        <KpiCard
          label="Packing — boxes per hour"
          icon={PackageCheck}
          tone="blue"
          value={data.packing.boxesPerHour == null ? "—" : data.packing.boxesPerHour.toFixed(1)}
          unit={data.packing.boxesPerHour == null ? undefined : "per hour"}
          sub={data.packing.boxesPerHour == null
            ? "Nothing packed yet today."
            : `${data.packing.totalBoxes} boxes over ${hours(data.packing.activeMinutes)} hours packing`}
        />
        <KpiCard
          label="Quality rejects"
          icon={AlertTriangle}
          tone="amber"
          value={String(data.wonkies.count)}
          unit="wonky"
          second={{ value: String(data.dogBins?.count ?? 0), unit: "dog bin" }}
          sub={`${formatQualityRejects(data.wonkies.count, data.dogBins?.count ?? 0)} — wonky is sold as wonky, dog bin is thrown away. ${data.wonkies.batchesTarget > 0
            ? `Across ${data.wonkies.batchesTarget} batches planned.`
            : "No batches planned today."}`}
        />
        <KpiCard
          label="Improvements completed"
          icon={Trophy}
          tone="violet"
          // 0 is a real zero — the team completed nothing today — so it
          // shows as 0, never a dash. Only a failed lookup shows "—".
          value={data.improvements?.completed == null ? "—" : String(data.improvements.completed)}
          unit={data.improvements?.completed == null ? undefined : "today"}
          sub={data.improvements?.completed == null
            ? "Couldn't count today's improvements."
            : data.improvements.completed === 0
              ? "Finished improvements only — ideas don't count until they're done."
              : `Finished and in the feed — ideas don't count until they're done.`}
        />
      </div>

      <p className="text-sm text-muted-foreground">
        The same four numbers the morning meeting reviews — these are today's, while everyone who can explain them is still here.
      </p>
    </div>
  );
}
