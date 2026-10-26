/**
 * Business → Floor map (Graeme, 2026-10-26): the to-scale factory plan as an
 * information overview — who is on each section today (the Planday rota, the
 * same mapping as the morning meeting's "Who's on today") and how each
 * section is doing (the same live paces and colours as the dashboard's Core
 * Production tiles, the factory number, the fridge and freezer sensors).
 * Founder only for now, while it's tried out.
 *
 * Read-only: every figure comes from an existing endpoint; nothing here is
 * worked out a second way. Layout and matching: lib/floor-map.ts.
 */
import { useEffect, useMemo, useState } from "react";
import { Redirect } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useListProductionPlans } from "@workspace/api-client-react";
import { isToday } from "date-fns";
import { Eye, EyeOff, Layers, Loader2, RotateCcw, Thermometer, Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { FounderNav } from "@/components/founder-nav";
import { useFounderArea } from "@/hooks/use-founder-area";
import { cn } from "@/lib/utils";
import { coreTileStatuses, BAND_TEXT_CLASS, type KpiBand } from "@/lib/station-kpi-bands";
import { AREAS, LAYERS, PLAN_H, PLAN_IMAGE, PLAN_W, areaForRotaStation, areaForSensor, defaultLayers, mergeLayers, pctBox, shortName, type Area, type AreaId, type LayerState } from "@/lib/floor-map";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function getJson<T>(path: string): Promise<T | null> {
  const r = await fetch(`${BASE}${path}`, { credentials: "include" });
  return r.ok ? (r.json() as Promise<T>) : null;
}

interface RotaPerson { name: string; start: string | null; end: string | null; position: string; punch: "in" | "finished" | "not-in"; late: boolean }
interface Assignments { available: boolean; reason?: string; stations: Array<{ title: string; people: RotaPerson[] }>; extras: RotaPerson[] }
interface Sensor { name: string; temperatureC: number | null; breaching: boolean; stale: boolean }

const BAND_FILL: Record<KpiBand, string> = {
  platinum: "bg-violet-100 border-violet-400 text-violet-900 dark:bg-violet-950/50 dark:text-violet-200",
  green: "bg-emerald-100 border-emerald-500 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200",
  amber: "bg-amber-100 border-amber-500 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
  red: "bg-red-100 border-red-500 text-red-900 dark:bg-red-950/50 dark:text-red-200",
  neutral: "bg-secondary border-border text-muted-foreground",
};

const AREA_FILL: Record<Area["kind"], string> = {
  room: "bg-card",
  cold: "bg-sky-50 dark:bg-sky-950/30",
  freezer: "bg-sky-100 dark:bg-sky-900/40",
  logistics: "bg-secondary/50",
  stairs: "bg-[repeating-linear-gradient(0deg,hsl(var(--muted-foreground)/0.25)_0_6px,transparent_6px_12px)]",
};

const LAYERS_KEY = "tck_floor_map_layers";

/** Which layers are showing — remembered on this device. */
function useLayers() {
  const [layers, setLayers] = useState<LayerState>(() => {
    try { return mergeLayers(JSON.parse(localStorage.getItem(LAYERS_KEY) ?? "null")); } catch { return defaultLayers(); }
  });
  useEffect(() => {
    try { localStorage.setItem(LAYERS_KEY, JSON.stringify(layers)); } catch { /* private mode: not remembered */ }
  }, [layers]);
  return [layers, setLayers] as const;
}

export default function FounderFloor() {
  const { ready, isFounder, home } = useFounderArea();
  const [layers, setLayers] = useLayers();
  const enabled = ready && isFounder;

  const rota = useQuery({
    queryKey: ["floor-map-rota"],
    queryFn: () => getJson<Assignments>("/api/morning-meetings/station-assignments"),
    enabled, refetchInterval: 2 * 60_000,
  });
  const { data: plans } = useListProductionPlans();
  const todayPlanId = plans?.find(p => isToday(new Date(p.planDate)))?.id ?? null;
  // Same endpoints and keys as the dashboard tiles, so they share the cache.
  const build = useQuery({
    queryKey: ["dashboard-build-kpi", todayPlanId],
    queryFn: () => getJson<{ batchesPerHour?: number; activeMinutes?: number }>(`/api/production-plans/${todayPlanId}/kpi?stationType=building_1`),
    enabled: enabled && todayPlanId != null, refetchInterval: 30_000,
  });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  const packing = useQuery({
    queryKey: ["dashboard-packing-speed", today],
    queryFn: async () => {
      const d = await getJson<{ dailyRows?: Array<{ ordersPerHour: number | null; count: number; activeMinutes?: number | null }> }>(`/api/reports/packing-speed?from=${today}&to=${today}`);
      return d?.dailyRows?.[0] ?? null;
    },
    enabled, refetchInterval: 60_000,
  });
  const wrapping = useQuery({
    queryKey: ["dashboard-wrapping-speed"],
    queryFn: () => getJson<{ packsPerHour: number | null; activeMinutes: number | null }>("/api/reports/wrapping-speed"),
    enabled, refetchInterval: 60_000,
  });
  const stock = useQuery({
    queryKey: ["stock-control-dashboard"],
    queryFn: () => getJson<{ productionFridgeTotal: number }>("/api/stock-control"),
    enabled, staleTime: 5 * 60_000,
  });
  const govee = useQuery({
    queryKey: ["govee-live"],
    queryFn: () => getJson<{ enabled: boolean; sensors: Sensor[] }>("/api/govee/live"),
    enabled, refetchInterval: 60_000, retry: false,
  });

  const kpis = coreTileStatuses({
    run_rate: todayPlanId != null && build.data ? { rate: build.data.batchesPerHour ?? null, activeMinutes: build.data.activeMinutes ?? null } : null,
    wrapping: wrapping.data ? { rate: wrapping.data.packsPerHour, activeMinutes: wrapping.data.activeMinutes } : null,
    packing: packing.data ? { rate: packing.data.ordersPerHour, activeMinutes: packing.data.activeMinutes ?? null } : null,
  });

  const peopleByArea = useMemo(() => {
    const m = new Map<AreaId, Array<RotaPerson & { station: string }>>();
    const elsewhere: Array<RotaPerson & { station: string }> = [];
    for (const st of rota.data?.stations ?? []) {
      const area = areaForRotaStation(st.title);
      for (const p of st.people) {
        if (area) m.set(area, [...(m.get(area) ?? []), { ...p, station: st.title }]);
        else elsewhere.push({ ...p, station: st.title });
      }
    }
    for (const p of rota.data?.extras ?? []) elsewhere.push({ ...p, station: p.position });
    return { m, elsewhere };
  }, [rota.data]);

  const tempsByArea = useMemo(() => {
    const m = new Map<AreaId, Sensor[]>();
    for (const s of govee.data?.sensors ?? []) {
      const a = areaForSensor(s.name);
      if (a) m.set(a, [...(m.get(a) ?? []), s]);
    }
    return m;
  }, [govee.data]);

  if (!ready) return null;
  if (!isFounder) return <Redirect to={home ?? "/"} />;

  const lineStatus = kpis.building;
  const onShift = [...peopleByArea.m.values()].flat().concat(peopleByArea.elsewhere);
  const inNow = onShift.filter(p => p.punch === "in").length;

  // Short enough for a small room; the full sentence is in "Live figures".
  const paceText = (rate: number | null | undefined, minutes: number | null | undefined, unit: string, target: string, dp: number) =>
    rate != null && rate > 0 && (minutes ?? 0) >= 30 ? `${rate.toFixed(dp)}${unit} · target ${target}` : "warming up";
  const kpiFor = (a: Area): { text: string | null; band: KpiBand } | null => {
    // The line's pace is said once, in the building room; dough, mixing and
    // ovens just take its colour.
    if (a.kpi === "run_rate") return { text: a.id === "building" ? paceText(build.data?.batchesPerHour, build.data?.activeMinutes, "/hr", "20/hr", 1) : null, band: lineStatus.band };
    if (a.kpi === "wrapping") return { text: paceText(wrapping.data?.packsPerHour, wrapping.data?.activeMinutes, " packs/hr", "180", 0), band: kpis.wrapping.band };
    if (a.kpi === "packing") return { text: paceText(packing.data?.ordersPerHour, packing.data?.activeMinutes, " orders/hr", "50", 1), band: kpis.packing.band };
    if (a.kpi === "factory_number" && stock.data) return { text: `${stock.data.productionFridgeTotal.toLocaleString("en-GB")} packs`, band: "neutral" };
    return null;
  };

  return (
    <div className="space-y-4">
      <FounderNav />
      <PageHeader title="Floor map" description="Who's on each section today, and how each section is doing — live." />

      {/* The production line's pace, big — it runs along the top of the plan. */}
      <div className={cn("rounded-2xl border-2 px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-1", BAND_FILL[lineStatus.band])}>
        <p className="text-sm font-bold uppercase tracking-wide">Production line · dough → building → ovens</p>
        <p className="text-2xl font-display font-bold">
          {paceText(build.data?.batchesPerHour, build.data?.activeMinutes, " batches/hr", "20", 1) === "warming up"
            ? (todayPlanId == null ? "No production plan today" : "Warming up — the pace shows after 30 minutes' work")
            : paceText(build.data?.batchesPerHour, build.data?.activeMinutes, " batches/hr", "20", 1)}
        </p>
        <p className="text-sm ml-auto flex items-center gap-1.5"><Users className="w-4 h-4" /> {inNow} clocked in · {onShift.length} on the rota today</p>
      </div>

      {/* Layers: switch what the map shows (Graeme, 2026-10-26). */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Map layers">
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-muted-foreground mr-1"><Layers className="w-4 h-4" /> Layers</span>
        {LAYERS.map(l => {
          const on = layers[l.id];
          // The drawing prints its own room names, so ours would double up.
          const covered = l.id === "labels" && layers.drawing;
          return (
            <button key={l.id} type="button" title={covered ? "The drawing shows the room names" : l.hint} aria-pressed={on}
              disabled={covered}
              onClick={() => setLayers(prev => ({ ...prev, [l.id]: !prev[l.id] }))}
              className={cn("h-11 px-4 rounded-xl border-2 font-semibold inline-flex items-center gap-2 transition-colors disabled:opacity-40",
                on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary")}>
              {on ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}{l.label}
            </button>
          );
        })}
        <button type="button" onClick={() => setLayers(defaultLayers())}
          className="h-11 px-3 rounded-xl text-sm font-semibold text-muted-foreground hover:bg-secondary inline-flex items-center gap-1.5">
          <RotateCcw className="w-4 h-4" /> Default view
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px] items-start">
        {/* The plan: as wide as the panel, capped by screen height so it fits without scrolling. */}
        <div className="w-full mx-auto" style={{ maxWidth: `calc((100dvh - 230px) * ${PLAN_W / PLAN_H})` }}>
          <div className="relative w-full rounded-2xl border-2 border-border bg-background" style={{ aspectRatio: `${PLAN_W} / ${PLAN_H}` }}>
            {layers.drawing ? (
              // The to-scale drawing: walls, doors, fridges and its own room
              // names. Areas sit over it in the drawing's pixels.
              <img src={`${BASE}${PLAN_IMAGE}`} alt="Factory floor plan" draggable={false}
                className="absolute inset-0 w-full h-full select-none pointer-events-none rounded-2xl dark:invert dark:hue-rotate-180" />
            ) : (
              // Without the drawing, just the building's outer walls.
              <div className="absolute border-[3px] border-muted-foreground/50 rounded-sm" style={pctBox([240, 118, 848, 914])} />
            )}
            {AREAS.map(a => {
              const people = peopleByArea.m.get(a.id) ?? [];
              const temps = tempsByArea.get(a.id) ?? [];
              const kpi = kpiFor(a);
              const banded = layers.kpis && kpi && kpi.band !== "neutral";
              return (
                <div key={a.id} style={pctBox(a.rect)}
                  className={cn("absolute border-2 rounded-md p-[0.6%] flex flex-col gap-[3%] overflow-hidden",
                    // Over the drawing the areas are see-through: only an
                    // area with something to say gets an outline.
                    layers.drawing ? "bg-transparent" : AREA_FILL[a.kind],
                    banded ? BAND_BORDER[kpi!.band] : layers.people && people.length ? "border-primary/60" : layers.drawing ? "border-transparent" : "border-border")}
                  title={a.label}>
                  {layers.labels && !layers.drawing && (
                    // Narrow areas (stairs, goods in) get smaller type so a
                    // word never breaks in the middle.
                    <p className="font-bold uppercase text-muted-foreground leading-tight [overflow-wrap:normal]"
                      style={{ fontSize: a.rect[2] < 130 ? "clamp(6px, 0.7vw, 11px)" : "clamp(8px, 1.05vw, 14px)", letterSpacing: a.rect[2] < 130 ? 0 : "0.03em" }}>
                      {a.label}
                    </p>
                  )}
                  {layers.kpis && kpi?.text && (
                    <span className={cn("self-start rounded-md border px-1.5 py-0.5 font-bold tabular-nums leading-tight", BAND_FILL[kpi.band])} style={{ fontSize: "clamp(9px, 1.05vw, 15px)" }}>
                      {kpi.text}
                    </span>
                  )}
                  {layers.sensors && temps.length > 0 && (
                    <span className="flex flex-wrap gap-1">
                      {temps.map(s => (
                        <span key={s.name} title={s.name}
                          className={cn("inline-flex items-center gap-0.5 rounded px-1 tabular-nums font-semibold leading-tight",
                            s.breaching ? "bg-red-600 text-white" : s.stale || s.temperatureC == null ? "bg-muted text-muted-foreground" : "bg-sky-600/90 text-white")}
                          style={{ fontSize: "clamp(8px, 0.9vw, 12px)" }}>
                          <Thermometer className="w-[1em] h-[1em]" />{s.temperatureC == null ? "—" : `${s.temperatureC.toFixed(1)}°`}
                        </span>
                      ))}
                    </span>
                  )}
                  {layers.people && people.length > 0 && (
                    <span className="flex flex-wrap gap-1 mt-auto">
                      {people.map(p => <PersonChip key={`${p.name}-${p.start}`} p={p} />)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <Legend />
        </div>

        <aside className="space-y-3">
          <div className="rounded-2xl border-2 border-border bg-card p-4 space-y-2">
            <p className="text-lg font-bold">Today's rota</p>
            {rota.isLoading && <p className="text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Reading Planday…</p>}
            {rota.data && !rota.data.available && <p className="text-muted-foreground">{rota.data.reason ?? "Planday isn't available."}</p>}
            {AREAS.filter(a => peopleByArea.m.has(a.id)).map(a => (
              <div key={a.id}>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{a.label}</p>
                <div className="flex flex-wrap gap-1 mt-0.5">{peopleByArea.m.get(a.id)!.map(p => <PersonChip key={`${p.name}-${p.start}`} p={p} long />)}</div>
              </div>
            ))}
            {peopleByArea.elsewhere.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Elsewhere today</p>
                <div className="flex flex-wrap gap-1 mt-0.5">{peopleByArea.elsewhere.map(p => <PersonChip key={`${p.name}-${p.station}`} p={p} long showStation />)}</div>
              </div>
            )}
          </div>
          <div className="rounded-2xl border-2 border-border bg-card p-4 space-y-1.5 text-sm">
            <p className="text-lg font-bold">Live figures</p>
            <p><span className="font-semibold">Line:</span> <span className={BAND_TEXT_CLASS[kpis.building.band]}>{kpis.building.label}</span></p>
            <p><span className="font-semibold">Wrapping:</span> <span className={BAND_TEXT_CLASS[kpis.wrapping.band]}>{kpis.wrapping.label}</span></p>
            <p><span className="font-semibold">Packing:</span> <span className={BAND_TEXT_CLASS[kpis.packing.band]}>{kpis.packing.label}</span></p>
            {stock.data && <p><span className="font-semibold">Factory number:</span> {stock.data.productionFridgeTotal.toLocaleString("en-GB")} packs</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}

const BAND_BORDER: Record<KpiBand, string> = {
  platinum: "border-violet-500", green: "border-emerald-500", amber: "border-amber-500", red: "border-red-500", neutral: "border-border",
};

function PersonChip({ p, long = false, showStation = false }: { p: RotaPerson & { station: string }; long?: boolean; showStation?: boolean }) {
  const state = p.late ? "late" : p.punch;
  return (
    <span
      title={`${p.name} · ${p.station}${p.start ? ` · ${p.start}–${p.end ?? ""}` : ""}${p.late ? " · not clocked in yet" : p.punch === "in" ? " · clocked in" : p.punch === "finished" ? " · finished" : ""}`}
      className={cn("inline-flex items-center gap-1 rounded-full border font-semibold leading-tight max-w-full",
        long ? "px-2 py-0.5 text-sm" : "px-1.5 py-0.5",
        state === "in" ? "bg-emerald-600 border-emerald-700 text-white"
        : state === "late" ? "bg-amber-400 border-amber-500 text-amber-950"
        : state === "finished" ? "bg-muted border-border text-muted-foreground line-through"
        : "bg-card border-primary/50 text-foreground")}
      style={long ? undefined : { fontSize: "clamp(8px, 0.95vw, 13px)" }}
    >
      <span className="truncate">{long ? p.name : shortName(p.name)}</span>
      {showStation && <span className="font-normal opacity-80 truncate">· {p.station}</span>}
    </span>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-emerald-600" /> Clocked in</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-card border border-primary/50" /> Rota'd, not started yet</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-amber-400" /> Late — not clocked in</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-muted border" /> Finished</span>
      <span className="inline-flex items-center gap-1.5"><Thermometer className="w-3.5 h-3.5 text-sky-600" /> Live sensor (red = out of range)</span>
    </div>
  );
}
