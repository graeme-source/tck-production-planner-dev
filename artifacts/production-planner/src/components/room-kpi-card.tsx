/**
 * Packing & wrapping room run rate on Analytics → Production KPIs (Graeme,
 * 13 Nov 2026). One % for the team's whole day: boxes packed, packs wrapped
 * and deliveries received, credited in hours, against every paid hour on the
 * Planday Packer + Wrapper shifts. 100% = a typical recent day. Scores are
 * worked out overnight (the room finishes last). Rules: api lib/room-kpi.ts.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Boxes, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { SaveChip } from "@/components/save-chip";
import { useAutosave } from "@/hooks/use-autosave";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const KEY = ["production-kpis", "room"] as const;

type Band = "platinum" | "green" | "amber" | "red" | "neutral";
interface RoomDayRow {
  date: string; boxes: number; packs: number; deliveries: number; deliveryLines: number;
  paidHours: number; people: number; status: string;
  packingHours: number; wrappingHours: number; deliveryHours: number; earnedHours: number;
  score: number | null; band: Band;
}
interface RoomResponse {
  days: RoomDayRow[];
  weights: { packingPerHour: number; wrappingPerHour: number; deliveryMinutes: number; lineMinutes: number };
  positions: string[];
  standardRatio: number | null;
  standardSetOn: string | null;
  canEdit: boolean;
}

const BAND_BG: Record<Band, string> = {
  platinum: "bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 text-white",
  green: "bg-[#7cb342] text-white",
  amber: "bg-yellow-400 text-stone-900",
  red: "bg-rose-600 text-white",
  neutral: "bg-stone-300 text-stone-800",
};

const day = (d: string) => format(parseISO(d), "EEE d MMM");
const h = (n: number) => `${n.toFixed(1)} h`;

function whatLine(d: RoomDayRow): string {
  return `${d.boxes} boxes · ${d.packs} packs · ${d.deliveries} deliver${d.deliveries === 1 ? "y" : "ies"} (${d.deliveryLines} lines) · ${h(d.paidHours)} paid${d.people ? `, ${d.people} people` : ""}`;
}

function Settings({ data }: { data: RoomResponse }) {
  const qc = useQueryClient();
  const [delivery, setDelivery] = useState(String(data.weights.deliveryMinutes));
  const [line, setLine] = useState(String(data.weights.lineMinutes));
  useEffect(() => { setDelivery(String(data.weights.deliveryMinutes)); setLine(String(data.weights.lineMinutes)); }, [data.weights.deliveryMinutes, data.weights.lineMinutes]);
  const auto = useAutosave<{ deliveryMinutes: number; lineMinutes: number }>(async (v) => {
    const res = await fetch(`${BASE}/api/production-kpis/room-settings`, {
      method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't save");
    await qc.invalidateQueries({ queryKey: KEY });
  });
  const change = (field: "d" | "l", v: string) => {
    if (field === "d") setDelivery(v); else setLine(v);
    const next = { deliveryMinutes: Number(field === "d" ? v : delivery), lineMinutes: Number(field === "l" ? v : line) };
    if (Number.isFinite(next.deliveryMinutes) && Number.isFinite(next.lineMinutes) && next.deliveryMinutes >= 0 && next.lineMinutes >= 0) auto.schedule(next);
  };
  const recal = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/production-kpis/room/recalibrate`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't reset");
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: KEY }); toast({ title: "100% reset to the last 4 weeks' typical day" }); },
    onError: (e: Error) => toast({ title: "Not reset", description: e.message, variant: "destructive" }),
  });
  const input = "w-24 bg-background border border-border rounded-xl px-3 py-2 text-2xl font-display font-extrabold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30";
  return (
    <div className="rounded-2xl bg-secondary/50 p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-4">
        <label className="space-y-1 block">
          <span className="text-sm font-semibold text-muted-foreground block">Minutes per delivery</span>
          <input type="number" min={0} step="1" inputMode="numeric" value={delivery} onChange={e => change("d", e.target.value)} onBlur={() => void auto.flush()} className={input} aria-label="Minutes per delivery" />
        </label>
        <label className="space-y-1 block">
          <span className="text-sm font-semibold text-muted-foreground block">Minutes per line received</span>
          <input type="number" min={0} step="0.5" inputMode="decimal" value={line} onChange={e => change("l", e.target.value)} onBlur={() => void auto.flush()} className={input} aria-label="Minutes per line received" />
        </label>
        <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />
        <button
          type="button"
          onClick={() => recal.mutate()}
          disabled={recal.isPending}
          className="ml-auto inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl border-2 border-border font-semibold hover:bg-background disabled:opacity-50"
        >
          {recal.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
          Reset 100% to the last 4 weeks
        </button>
      </div>
    </div>
  );
}

export function RoomKpiCard() {
  const { data, isLoading, isError } = useQuery<RoomResponse>({
    queryKey: KEY,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/production-kpis/room`, { credentials: "include" });
      if (!res.ok) throw new Error("Couldn't load the room run rate");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });
  const latest = data?.days.find(d => d.status === "ok" && d.score != null) ?? data?.days[0] ?? null;

  return (
    <section className="rounded-3xl border-2 border-border bg-card p-5 lg:p-6 space-y-4 shadow-sm md:col-span-2 2xl:col-span-3">
      <div className="flex items-start gap-3">
        <span className="w-12 h-12 rounded-2xl bg-[#7cb342]/15 text-[#558b2f] flex items-center justify-center shrink-0"><Boxes className="w-6 h-6" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-display font-extrabold">Packing & wrapping room</h2>
          <p className="text-muted-foreground">The whole day — every paid hour on the {data?.positions.join(" and ") ?? "Packer and Wrapper"} shifts. 100% = a typical day.</p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>
      ) : isError || !data ? (
        <p className="text-muted-foreground">Couldn't load the room run rate.</p>
      ) : data.days.length === 0 ? (
        <p className="text-lg text-muted-foreground">The first weeks fill in a few minutes after this goes live; after that each day's score appears the next morning.</p>
      ) : (
        <>
          {latest && (
            <div className="flex flex-wrap items-stretch gap-4">
              <div className={cn("rounded-2xl px-6 py-4 min-w-[10rem] text-center flex flex-col justify-center", BAND_BG[latest.band])}>
                <span className="text-sm font-semibold opacity-90">{day(latest.date)}</span>
                <span className="text-5xl font-display font-extrabold tabular-nums leading-tight">{latest.score != null ? `${latest.score}%` : "—"}</span>
              </div>
              <div className="flex-1 min-w-[16rem] space-y-1.5 text-base">
                <p className="font-semibold">{whatLine(latest)}</p>
                <p className="text-muted-foreground">
                  Credited {h(latest.earnedHours)}: packing {h(latest.packingHours)}, wrapping {h(latest.wrappingHours)}, deliveries {h(latest.deliveryHours)}.
                </p>
                <p className="text-sm text-muted-foreground">
                  A box = 1 of {data.weights.packingPerHour}/hr, a pack = 1 of {data.weights.wrappingPerHour}/hr (the standards above), a delivery {data.weights.deliveryMinutes} min + {data.weights.lineMinutes} min a line.
                  {data.standardSetOn ? ` 100% set from the days before ${day(data.standardSetOn)}.` : " The 100% line is set from the first weeks of history."}
                </p>
              </div>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {data.days.slice(0, 15).map(d => (
              <div key={d.date} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2">
                <span className={cn("rounded-lg px-2.5 py-1 font-display font-extrabold tabular-nums min-w-[4rem] text-center", BAND_BG[d.band])}>
                  {d.score != null ? `${d.score}%` : "—"}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold">{day(d.date)}{d.status === "pending" ? " · waiting for Planday approval" : ""}</p>
                  <p className="text-sm text-muted-foreground">{d.boxes} boxes · {d.packs} packs · {d.deliveries} del. · {h(d.paidHours)}</p>
                </div>
              </div>
            ))}
          </div>

          {data.canEdit && <Settings data={data} />}
        </>
      )}
    </section>
  );
}
