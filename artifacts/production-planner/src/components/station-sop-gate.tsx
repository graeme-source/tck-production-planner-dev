/**
 * Station SOP gate (Graeme, 2026-09-24).
 *
 * When someone opens a station on its LIVE plan and there are SOPs on the
 * front of that station they've never reviewed — or that have changed since
 * they last did — the station sits behind this screen until they review
 * them. The first time they're asked, they get 24 hours to put it off
 * ("Skip for now"); after that it's review or leave. People the Planday
 * rota doesn't put on this station today can say they're just checking
 * something instead (logged). "Leave station" is always there, so the gate
 * can block work without ever trapping anyone.
 *
 * With the gate lifted but reviews still outstanding (skipped, just
 * checking, or enforcement switched off) a slim amber banner stays on the
 * station with a Review button.
 *
 * The rules are decided server-side (lib/station-sop-training.ts) — this
 * component only renders the verdict.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { GraduationCap, CheckCircle2, RefreshCw, BookOpen, LogOut, Loader2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { SopReviewPlayer } from "@/components/sop-review-player";
import { isLiveStationPlan, londonToday, timeLeft, type GateState, type GateSop } from "@/lib/station-training";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function post(path: string, station: string): Promise<GateState> {
  const res = await fetch(`${BASE}/api/station-training/${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ station }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? "Something went wrong");
  return body as GateState;
}

export function StationSopGate({ stationType, stationLabel, planDate }: {
  stationType: string;
  stationLabel: string;
  planDate: string | null | undefined;
}) {
  const { state } = useAuth();
  const userId = state.status === "authenticated" ? state.user.id : 0;
  const live = isLiveStationPlan(stationType, planDate, londonToday());
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [reviewing, setReviewing] = useState<GateSop | null>(null);
  // Opened from the banner: same list, but "Not now" instead of the gate's
  // skip — they've already been let in.
  const [voluntary, setVoluntary] = useState(false);

  const queryKey = ["station-gate", stationType, userId];
  const { data } = useQuery<GateState>({
    queryKey,
    enabled: live && userId > 0,
    queryFn: () => post("gate/check", stationType),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const act = useMutation({
    mutationFn: (path: "gate/skip" | "gate/just-looking") => post(path, stationType),
    onSuccess: next => queryClient.setQueryData(queryKey, next),
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  if (!live || !data) return null;
  const outstanding = data.sops.filter(s => s.status !== "trained");
  if (outstanding.length === 0 && !reviewing) return null;

  const afterReview = () => {
    setReviewing(null);
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ["station-training"] });
  };

  const player = reviewing && (
    <SopReviewPlayer
      sopId={reviewing.sopId}
      version={reviewing.currentVersion}
      source="station_gate"
      station={stationType}
      onClose={() => setReviewing(null)}
      onReviewed={afterReview}
    />
  );

  const blocking = data.decision.show;
  const earliest = outstanding.map(s => s.deadline).filter(Boolean).sort()[0] ?? null;

  if (!blocking && !voluntary) {
    // The reminder strip on the station itself.
    return (
      <>
        <div className="mb-3 rounded-2xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 flex items-center gap-3 flex-wrap">
          <GraduationCap className="w-6 h-6 text-amber-600 flex-shrink-0" />
          <p className="flex-1 min-w-0 text-base font-semibold text-amber-900 dark:text-amber-100">
            {outstanding.length === 1 ? "1 SOP to review" : `${outstanding.length} SOPs to review`} for this station
            {data.enforce && timeLeft(earliest) && <span className="font-normal"> · required in {timeLeft(earliest)}</span>}
            {data.pass?.kind === "just_looking" && <span className="font-normal"> · you said you're just checking today</span>}
          </p>
          <button
            onClick={() => setVoluntary(true)}
            className="h-11 px-5 rounded-xl bg-amber-500 text-white text-base font-bold hover:bg-amber-600"
          >
            Review now
          </button>
        </div>
        {player}
      </>
    );
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-[250] bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div className="bg-background w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl max-h-[92dvh] flex flex-col" role="dialog" aria-modal="true" aria-label="SOPs to review">
          <div className="p-5 pb-3 space-y-1">
            <div className="flex items-center gap-2 text-primary">
              <GraduationCap className="w-6 h-6" />
              <span className="text-sm font-bold uppercase tracking-wide">Station training</span>
            </div>
            <h2 className="text-2xl font-bold leading-tight">
              {blocking ? `Before you start on ${stationLabel}` : `SOPs to review — ${stationLabel}`}
            </h2>
            <p className="text-base text-muted-foreground">
              {blocking
                ? "These SOPs are new to you or have changed since you last reviewed them. Review each one to open the station."
                : "Review these when you have a minute — it records you as trained on this station."}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-5 space-y-3">
            {data.sops.map(s => {
              const done = s.status === "trained";
              const left = timeLeft(s.deadline);
              return (
                <div
                  key={s.sopId}
                  className={cn(
                    "rounded-2xl border-2 p-4 flex items-center gap-3",
                    done ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : s.required ? "border-red-400" : "border-border bg-card",
                  )}
                >
                  {done ? <CheckCircle2 className="w-7 h-7 text-emerald-600 flex-shrink-0" />
                    : s.status === "refresher" ? <RefreshCw className="w-7 h-7 text-amber-600 flex-shrink-0" />
                    : <BookOpen className="w-7 h-7 text-primary flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-lg font-bold leading-snug">{s.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {done ? "Trained — thank you"
                        : s.status === "refresher" ? "Changed since you last reviewed it"
                        : "You haven't reviewed this yet"}
                      {" · "}{s.stepCount} steps
                      {!done && data.enforce && (s.required
                        ? <span className="text-red-600 font-semibold"> · required now</span>
                        : left ? <span> · can wait {left}</span> : null)}
                    </p>
                  </div>
                  {!done && (
                    <button
                      onClick={() => setReviewing(s)}
                      className="h-12 px-5 rounded-xl bg-primary text-primary-foreground text-base font-bold flex-shrink-0"
                    >
                      Review
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="p-5 pt-4 space-y-3">
            {blocking && data.decision.canSkip && (
              <button
                onClick={() => act.mutate("gate/skip")}
                disabled={act.isPending}
                className="w-full text-sm font-medium text-muted-foreground underline underline-offset-2 py-2 flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Clock className="w-4 h-4" />
                Skip for now — you have {timeLeft(data.decision.skipUntil) ?? "a little while"} before these are required
              </button>
            )}
            {blocking && data.decision.canJustLook && (
              <button
                onClick={() => act.mutate("gate/just-looking")}
                disabled={act.isPending}
                className="w-full text-sm font-medium text-muted-foreground underline underline-offset-2 py-2 disabled:opacity-50"
              >
                I'm just checking something — not working this station
              </button>
            )}
            {act.isPending && <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />}
            {blocking ? (
              <button
                onClick={() => navigate("/")}
                className="w-full h-14 rounded-2xl border-2 border-border text-lg font-bold flex items-center justify-center gap-2 hover:bg-secondary/50"
              >
                <LogOut className="w-5 h-5" /> Leave station
              </button>
            ) : (
              <button
                onClick={() => setVoluntary(false)}
                className="w-full h-14 rounded-2xl border-2 border-border text-lg font-bold hover:bg-secondary/50"
              >
                {outstanding.length === 0 ? "Done" : "Not now"}
              </button>
            )}
          </div>
        </div>
      </div>
      {player}
    </>,
    document.body,
  );
}
