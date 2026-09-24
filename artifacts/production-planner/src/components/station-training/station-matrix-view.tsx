/**
 * One station's training matrix, inside the Training section at
 * /training/stations/:station (Graeme, 2026-09-24).
 *
 * Built live from the SOPs on the front of the station: attach an SOP there
 * and it's a column here; change its steps and everyone who reviewed the old
 * version drops to "needs refresher". Anyone can review the station's SOPs
 * right here ("Your SOPs") and be recorded as trained with the date and time;
 * the team grid below shows everyone else. Nothing here is a stored matrix,
 * so there's nothing to edit — the SOPs themselves are the source.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, BookOpen, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { SopReviewPlayer } from "@/components/sop-review-player";
import { STATUS_LABEL, type ReviewStatus } from "@/lib/station-training";
import { StatusIcon, fmtWhen, getStationTraining, stationLabel } from "./shared";

interface MatrixSop { sopId: number; title: string; stepCount: number; currentVersion: number; changedAt: string }
interface MatrixCell { status: ReviewStatus; reviewedAt: string | null; source: string | null }
interface MatrixPerson { userId: number; name: string; worksHere: boolean; cells: Record<string, MatrixCell> }

export function StationMatrixView({ station, backHref }: { station: string; backHref: string }) {
  const { state } = useAuth();
  const myId = state.status === "authenticated" ? state.user.id : 0;
  const queryClient = useQueryClient();
  const [reviewing, setReviewing] = useState<MatrixSop | null>(null);
  const [onlyWorksHere, setOnlyWorksHere] = useState(true);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["station-training", "matrix", station],
    queryFn: () => getStationTraining<{ station: string; sops: MatrixSop[]; people: MatrixPerson[] }>(`/stations/${encodeURIComponent(station)}/matrix`),
  });

  const me = data?.people.find(p => p.userId === myId);
  const anyWorksHere = (data?.people ?? []).some(p => p.worksHere);
  const shown = (data?.people ?? []).filter(p => !onlyWorksHere || !anyWorksHere || p.worksHere || p.userId === myId);

  return (
    <div className="space-y-6">
      <div>
        <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="w-4 h-4" /> All training
        </Link>
        <h2 className="text-2xl font-display font-bold mt-1">
          {stationLabel(station)} <span className="text-muted-foreground font-semibold">— SOPs</span>
        </h2>
        <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
          Built automatically from the SOPs on the front of this station — change an SOP there and this matrix follows.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
      )}
      {isError && <p className="text-base text-destructive">Couldn't load this station's matrix — refresh the page to try again.</p>}
      {data && data.sops.length === 0 && (
        <p className="text-base text-muted-foreground">
          No SOPs on this station yet. Attach one to the station, or to a recipe, ingredient or checklist used there, and it becomes this station's training automatically.
        </p>
      )}

      {data && data.sops.length > 0 && (
        <>
          <section className="space-y-3">
            <h3 className="text-lg font-bold">Your SOPs</h3>
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
              <h3 className="text-lg font-bold">The team</h3>
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
