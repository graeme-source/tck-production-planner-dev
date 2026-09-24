/**
 * Station training (Graeme, 2026-09-24) — /station-training and
 * /station-training/:station.
 *
 * One training matrix per station, built automatically from the SOPs on the
 * front of that station: attach an SOP there and it's a column here; change
 * its steps and everyone who reviewed the old version drops to "needs
 * refresher". Anyone can open a station, review its SOPs right here, and be
 * recorded as trained with the date and time.
 *
 * Open to every colleague (people train themselves). The enforcement switch
 * at the top is admin-only.
 */
import { useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { GraduationCap, ChevronLeft, CheckCircle2, RefreshCw, Minus, BookOpen, ChevronRight, ShieldCheck, ShieldOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { STATIONS } from "@/pages/station/shared/constants";
import { SopReviewPlayer } from "@/components/sop-review-player";
import { STATUS_LABEL, type ReviewStatus } from "@/lib/station-training";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const EXTRA_LABELS: Record<string, string> = {
  main_prep: "Main Prep",
  prep_bases: "Bases & Sauces",
  prep_meat: "Raw Meat",
};
const stationLabel = (key: string) =>
  STATIONS.find(s => s.key === key)?.label ?? EXTRA_LABELS[key] ?? key.replace(/_/g, " ");

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/api/station-training${path}`, { credentials: "include" });
  if (!res.ok) throw new Error("Couldn't load station training");
  return res.json();
}

export default function StationTrainingPage() {
  const params = useParams<{ station?: string }>();
  return params.station ? <StationMatrix station={params.station} /> : <StationList />;
}

// ── All stations ───────────────────────────────────────────────────────────

interface StationSummary { station: string; sopCount: number; trained: number; refresher: number; untrained: number }

function StationList() {
  const { state } = useAuth();
  const isAdmin = state.status === "authenticated" && state.user.role === "admin";
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["station-training", "stations"],
    queryFn: () => getJson<{ enforce: boolean; stations: StationSummary[] }>("/stations"),
  });
  const setEnforce = useMutation({
    mutationFn: async (on: boolean) => {
      const res = await fetch(`${BASE}/api/station-training/enforce`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }),
      });
      if (!res.ok) throw new Error("Couldn't change the setting");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["station-training"] });
      queryClient.invalidateQueries({ queryKey: ["station-gate"] });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const byKey = new Map((data?.stations ?? []).map(s => [s.station, s]));
  const keys = [
    ...STATIONS.map(s => s.key as string),
    ...(data?.stations ?? []).map(s => s.station).filter(k => !STATIONS.some(s => s.key === k)),
  ];
  const withSops = keys.filter(k => byKey.has(k));
  const without = keys.filter(k => !byKey.has(k));

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2 text-primary">
          <GraduationCap className="w-7 h-7" />
          <h1 className="text-3xl font-display font-bold text-foreground">Station training</h1>
        </div>
        <p className="text-base text-muted-foreground mt-1">
          Every SOP on the front of a station is that station's training. Review them here or at the station —
          when an SOP changes, you'll be asked to review it again.
        </p>
      </div>

      {isAdmin && data && (
        <div className={cn(
          "rounded-2xl border-2 p-4 flex items-center gap-3 flex-wrap",
          data.enforce ? "border-primary/40 bg-primary/5" : "border-amber-400 bg-amber-50 dark:bg-amber-950/30",
        )}>
          {data.enforce ? <ShieldCheck className="w-6 h-6 text-primary" /> : <ShieldOff className="w-6 h-6 text-amber-600" />}
          <p className="flex-1 min-w-0 text-base">
            <span className="font-bold">{data.enforce ? "Stations require training" : "Station training is not enforced"}</span>
            <span className="text-muted-foreground"> — {data.enforce
              ? "people working a station must review its SOPs (24 hours' grace the first time)."
              : "outstanding reviews show as a reminder only; nobody is stopped."}</span>
          </p>
          <button
            onClick={() => setEnforce.mutate(!data.enforce)}
            disabled={setEnforce.isPending}
            className="h-11 px-4 rounded-xl border-2 border-border text-sm font-bold hover:bg-secondary/50 disabled:opacity-50"
          >
            {data.enforce ? "Switch off" : "Switch on"}
          </button>
        </div>
      )}

      {isLoading && <p className="text-muted-foreground">Loading…</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {withSops.map(key => {
          const s = byKey.get(key)!;
          const behind = s.refresher + s.untrained;
          return (
            <Link key={key} href={`/station-training/${key}`} className="block rounded-3xl border-2 border-border bg-card p-5 hover:border-primary active:scale-[0.99] transition-all">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xl font-bold">{stationLabel(key)}</h2>
                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">{s.sopCount} SOP{s.sopCount === 1 ? "" : "s"}</p>
                <div className="mt-3 h-2 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${(s.trained / s.sopCount) * 100}%` }} />
                </div>
                <p className={cn("mt-2 text-base font-semibold", behind > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400")}>
                  {behind === 0 ? "You're trained on all of them"
                    : `You: ${s.trained} of ${s.sopCount} trained${s.refresher > 0 ? ` · ${s.refresher} need${s.refresher === 1 ? "s" : ""} a refresher` : ""}`}
                </p>
              </Link>
          );
        })}
      </div>

      {without.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-muted-foreground mb-2">No SOPs on these stations yet</p>
          <div className="flex flex-wrap gap-2">
            {without.map(k => (
              <span key={k} className="px-3 py-1.5 rounded-xl bg-secondary/60 text-sm text-muted-foreground">{stationLabel(k)}</span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Add one from the station's ⋯ menu ("Add SOP to this station") and it appears here automatically.
          </p>
        </div>
      )}
    </div>
  );
}

// ── One station's matrix ───────────────────────────────────────────────────

interface MatrixSop { sopId: number; title: string; stepCount: number; currentVersion: number; changedAt: string }
interface MatrixCell { status: ReviewStatus; reviewedAt: string | null; source: string | null }
interface MatrixPerson { userId: number; name: string; worksHere: boolean; cells: Record<string, MatrixCell> }

function fmtWhen(ts: string | null): string {
  if (!ts) return "";
  try { return format(parseISO(ts.replace(" ", "T")), "d MMM, HH:mm"); } catch { return ""; }
}

function StationMatrix({ station }: { station: string }) {
  const { state } = useAuth();
  const myId = state.status === "authenticated" ? state.user.id : 0;
  const queryClient = useQueryClient();
  const [reviewing, setReviewing] = useState<MatrixSop | null>(null);
  const [onlyWorksHere, setOnlyWorksHere] = useState(true);
  const queryKey = ["station-training", "matrix", station];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => getJson<{ station: string; sops: MatrixSop[]; people: MatrixPerson[] }>(`/stations/${station}/matrix`),
  });

  const me = data?.people.find(p => p.userId === myId);
  const anyWorksHere = (data?.people ?? []).some(p => p.worksHere);
  const shown = (data?.people ?? []).filter(p => !onlyWorksHere || !anyWorksHere || p.worksHere || p.userId === myId);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <Link href="/station-training" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="w-4 h-4" /> All stations
          </Link>
        <h1 className="text-3xl font-display font-bold mt-1">{stationLabel(station)} — training</h1>
      </div>

      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {data && data.sops.length === 0 && (
        <p className="text-base text-muted-foreground">
          No SOPs on this station yet. Add one from the station's ⋯ menu and it becomes this station's training automatically.
        </p>
      )}

      {data && data.sops.length > 0 && (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-bold">Your SOPs</h2>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {data.sops.map(sop => {
                const cell = me?.cells[sop.sopId] ?? { status: "untrained" as ReviewStatus, reviewedAt: null, source: null };
                const done = cell.status === "trained";
                return (
                  <div key={sop.sopId} className={cn(
                    "rounded-2xl border-2 p-4 flex items-center gap-3",
                    done ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : cell.status === "refresher" ? "border-amber-400" : "border-border bg-card",
                  )}>
                    <StatusIcon status={cell.status} large />
                    <div className="flex-1 min-w-0">
                      <p className="text-lg font-bold leading-snug">{sop.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {done ? `Trained ${fmtWhen(cell.reviewedAt)}`
                          : cell.status === "refresher" ? `Changed ${fmtWhen(sop.changedAt)} — review it again`
                          : `${sop.stepCount} steps · not reviewed yet`}
                      </p>
                    </div>
                    <button
                      onClick={() => setReviewing(sop)}
                      className={cn(
                        "h-12 px-5 rounded-xl text-base font-bold flex-shrink-0",
                        done ? "border-2 border-border hover:bg-secondary/50" : "bg-primary text-primary-foreground",
                      )}
                    >
                      {done ? "Read again" : "Review"}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-lg font-bold">The team</h2>
              {anyWorksHere && (
                <div className="inline-flex rounded-xl border-2 border-border overflow-hidden text-sm font-semibold">
                  <button onClick={() => setOnlyWorksHere(true)} className={cn("px-3 py-2", onlyWorksHere && "bg-primary text-primary-foreground")}>Works here</button>
                  <button onClick={() => setOnlyWorksHere(false)} className={cn("px-3 py-2", !onlyWorksHere && "bg-primary text-primary-foreground")}>Everyone</button>
                </div>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              "Works here" = on the Planday rota for this station in the last 60 days.
            </p>
            <div className="rounded-2xl border border-border bg-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 font-semibold sticky left-0 bg-card min-w-[160px]">Person</th>
                    {data.sops.map(s => (
                      <th key={s.sopId} className="p-3 font-semibold text-left align-bottom min-w-[150px]">
                        <span className="flex items-start gap-1.5"><BookOpen className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />{s.title}</span>
                        <span className="block text-xs font-normal text-muted-foreground">changed {fmtWhen(s.changedAt)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map(p => (
                    <tr key={p.userId} className={cn("border-b border-border/60 last:border-0", p.userId === myId && "bg-primary/5")}>
                      <td className="p-3 sticky left-0 bg-card font-semibold">
                        {p.name}{p.userId === myId && <span className="text-muted-foreground font-normal"> (you)</span>}
                        {p.worksHere && <span className="ml-1.5 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">works here</span>}
                      </td>
                      {data.sops.map(s => {
                        const c = p.cells[s.sopId];
                        return (
                          <td key={s.sopId} className="p-3">
                            <span className={cn(
                              "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-medium",
                              c.status === "trained" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                                : c.status === "refresher" ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
                                : "text-muted-foreground",
                            )}>
                              <StatusIcon status={c.status} />
                              {c.status === "trained" ? fmtWhen(c.reviewedAt) : STATUS_LABEL[c.status]}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {reviewing && (
        <SopReviewPlayer
          sopId={reviewing.sopId}
          version={reviewing.currentVersion}
          source="matrix"
          station={station}
          onClose={() => setReviewing(null)}
          onReviewed={() => {
            setReviewing(null);
            queryClient.invalidateQueries({ queryKey: ["station-training"] });
            queryClient.invalidateQueries({ queryKey: ["station-gate"] });
          }}
        />
      )}
    </div>
  );
}

function StatusIcon({ status, large }: { status: ReviewStatus; large?: boolean }) {
  const cls = large ? "w-7 h-7 flex-shrink-0" : "w-4 h-4 flex-shrink-0";
  if (status === "trained") return <CheckCircle2 className={cn(cls, "text-emerald-600")} />;
  if (status === "refresher") return <RefreshCw className={cn(cls, "text-amber-600")} />;
  return <Minus className={cn(cls, "text-muted-foreground")} />;
}
