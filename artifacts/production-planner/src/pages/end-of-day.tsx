/**
 * End-of-day meeting — the three numbers reviewed before everyone goes home
 * (Graeme, 2026-09-17).
 *
 * The morning meeting asks "how did yesterday go?". This asks "how did TODAY
 * go?", while the people who can explain the number are still on site. Same
 * three KPIs, same server-side helpers — deliberately not re-derived here,
 * because a second way of working out a rate is how the meeting and the
 * Analytics page came to disagree once before.
 *
 * Kept deliberately bare: three numbers, big enough to read from across the
 * room, and nothing else to click.
 */
import { useQuery } from "@tanstack/react-query";
import { Loader2, Hammer, PackageCheck, AlertTriangle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface EndOfDay {
  date: string;
  hasPlan: boolean;
  builder: { batchesPerHour: number | null; totalBatches: number; activeMinutes: number };
  packing: { boxesPerHour: number | null; totalBoxes: number; activeMinutes: number };
  wonkies: { count: number; batchesTarget: number };
}

const hours = (mins: number) => (mins / 60).toFixed(1);

function KpiCard({ label, value, unit, sub, icon: Icon, tone }: {
  label: string;
  value: string;
  unit?: string;
  sub: string;
  icon: typeof Hammer;
  tone: "green" | "blue" | "amber";
}) {
  const tones = {
    green: "border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300",
    blue: "border-blue-300 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300",
    amber: "border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300",
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
          No production plan for today, so there are no wonkies to count. The rates below still read from what was actually built and packed.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Builders — batches per hour"
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
          label="Wonkies"
          icon={AlertTriangle}
          tone="amber"
          value={String(data.wonkies.count)}
          unit={data.wonkies.count === 1 ? "today" : "today"}
          sub={data.wonkies.batchesTarget > 0
            ? `Across ${data.wonkies.batchesTarget} batches planned`
            : "No batches planned today"}
        />
      </div>

      <p className="text-sm text-muted-foreground">
        The same three numbers the morning meeting reviews — these are today's, while everyone who can explain them is still here.
      </p>
    </div>
  );
}
