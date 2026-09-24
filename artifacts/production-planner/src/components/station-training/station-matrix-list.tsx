/**
 * Station matrices — the list, inside the Training section (Graeme,
 * 2026-09-24: "a training matrix for each station in the current training
 * section", not a separate top-level tab).
 *
 * One card per station that has SOPs anywhere on it (front screen, recipes,
 * ingredients, sub-recipes, checklists). Each is a matrix
 * built automatically from those SOPs — nothing is stored, so it can't be
 * edited here; attach or change an SOP at the station and the matrix follows.
 * Stations with no SOPs yet are a quiet list underneath.
 *
 * Everyone sees this (people train themselves). The enforcement switch is
 * admin-only, on the server as well as here.
 */
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ShieldCheck, ShieldOff, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { splitStations, stationTrainingPath } from "@/lib/training-sections";
import { STATION_TRAINING_API, TRAINING_STATION_KEYS, getStationTraining, stationLabel } from "./shared";

interface StationSummary { station: string; sopCount: number; trained: number; refresher: number; untrained: number }

export function StationMatrixList({ showEnforceSwitch }: { showEnforceSwitch: boolean }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["station-training", "stations"],
    queryFn: () => getStationTraining<{ enforce: boolean; stations: StationSummary[] }>("/stations"),
  });
  const setEnforce = useMutation({
    mutationFn: async (on: boolean) => {
      const res = await fetch(`${STATION_TRAINING_API}/enforce`, {
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

  const { withSops, without } = splitStations(TRAINING_STATION_KEYS, data?.stations ?? []);

  return (
    <div className="space-y-4">
      {showEnforceSwitch && data && (
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

      {isLoading && (
        <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
      )}
      {isError && <p className="text-base text-destructive">Couldn't load the station matrices — refresh the page to try again.</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {withSops.map(s => {
          const behind = s.refresher + s.untrained;
          return (
            <Link
              key={s.station}
              href={stationTrainingPath(s.station)}
              className="block rounded-3xl border-2 border-border bg-card p-5 hover:border-primary active:scale-[0.99] transition-all"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-xl font-bold leading-snug">
                  {stationLabel(s.station)} <span className="text-muted-foreground font-semibold">— SOPs</span>
                </h3>
                <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-1" />
              </div>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                <span>{s.sopCount} SOP{s.sopCount === 1 ? "" : "s"}</span>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-secondary">
                  <Sparkles className="w-3 h-3" /> Auto-built
                </span>
              </p>
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

      {data && without.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-muted-foreground mb-2">No SOPs on these stations yet</p>
          <div className="flex flex-wrap gap-2">
            {without.map(k => (
              <span key={k} className="px-3 py-1.5 rounded-xl bg-secondary/60 text-sm text-muted-foreground">{stationLabel(k)}</span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Attach an SOP to the station (⋯ menu → "Add SOP to this station"), or to a recipe, ingredient or checklist used there, and its matrix appears here automatically.
          </p>
        </div>
      )}
    </div>
  );
}
