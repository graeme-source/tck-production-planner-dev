/**
 * The Leaner-board (Objectives E and H). Both figures, over the same
 * rolling 30 days (Graeme, 2026-10-12: "I want the percentage, and I want
 * the number of improvements as well"):
 *   - the number of improvements — the big figure, and what ranks the board;
 *   - the improvement score — improvements ÷ shifts worked, with the maths
 *     ("4 improvements · 10 shifts") underneath and an encouraging next step.
 * Kept positive: brand green and warm amber only, never red, never "low".
 *
 * Shown on the Improvements page, which is also the morning meeting's
 * Improvements slide, so both carry it.
 */
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SCORE_EXPLAINER, SCORE_SMALL_PRINT, leanerStep, scoreDetail, scoreText, stepBarFill,
  type LeanerStepKey,
} from "@/lib/improvement-score";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type LeanerBoardRow = {
  userId: number | null;
  name: string;
  /** All-time completed improvements. */
  count: number;
  signedOff: number;
  lastAt: string | null;
  /** Last 30 days. */
  credits30: number;
  improvements30: number;
  shifts30: number | null;
  scorePct: number | null;
};

/** Warm for getting going, brand green once rolling. */
const STEP_PILL: Record<LeanerStepKey, string> = {
  waiting: "bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800",
  started: "bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800",
  rolling: "bg-primary/10 text-foreground border-primary/30",
  legend: "bg-primary text-primary-foreground border-primary",
};

const STEP_BAR: Record<LeanerStepKey, string> = {
  waiting: "bg-amber-400",
  started: "bg-amber-400",
  rolling: "bg-primary",
  legend: "bg-primary",
};

export function LeanerBoard() {
  const { data = [] } = useQuery<LeanerBoardRow[]>({
    queryKey: ["improvement-scoreboard"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/improvements/scoreboard`, { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't load the Leaner-board (${res.status})`);
      return res.json();
    },
    staleTime: 60_000,
  });
  if (data.length === 0) return null;

  // Anything completed before sign-off existed was retro-credited so the
  // tallies started from real history — but nobody approved it, so the
  // legacy portion is named rather than quietly counted as approvals.
  const legacy = data.reduce((n, r) => n + (r.count - r.signedOff), 0);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-500" /> Leaner-board
        </h2>
        <p className="text-base font-semibold text-muted-foreground mt-0.5">{SCORE_EXPLAINER}</p>
        <p className="text-sm text-muted-foreground mt-0.5">{SCORE_SMALL_PRINT}</p>
      </div>
      {legacy > 0 && (
        <p className="text-sm text-muted-foreground -mt-1">
          All-time counts include {legacy} completed before sign-off existed — those were never
          approved by anyone.
        </p>
      )}
      {/* One list, most improvements at the top — not columns (Graeme,
          2026-09-25). The server sends it already in order. */}
      <div className="space-y-2.5">
        {data.map(row => <LeanerCard key={row.userId ?? row.name} row={row} />)}
      </div>
    </section>
  );
}

function LeanerCard({ row }: { row: LeanerBoardRow }) {
  const step = leanerStep(row);
  const fill = step ? stepBarFill(row.scorePct, step.nextPct) : 0;
  return (
    <div className="rounded-2xl border-2 border-border bg-card px-4 py-4 min-w-0">
      <div className="flex items-start justify-between gap-4 min-w-0">
        <div className="min-w-0 flex-1">
          <p className="text-xl font-bold truncate">{row.name}</p>
          <p className="text-sm text-muted-foreground">{row.count} all-time</p>
        </div>
        {/* The main figure: improvements in the last 30 days. */}
        <div className="text-right flex-shrink-0">
          <p className={cn("text-5xl font-extrabold tabular-nums leading-none", row.improvements30 > 0 ? "text-primary" : "text-muted-foreground")}>
            {row.improvements30}
          </p>
          <p className="text-sm font-semibold text-muted-foreground mt-1">
            {row.improvements30 === 1 ? "improvement" : "improvements"}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-xl bg-muted/40 px-3 py-2.5">
        {/* No shifts to divide by = no % at all, just the count and why. */}
        {row.scorePct != null && (
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-base font-semibold">
              Score <span className="text-2xl font-extrabold tabular-nums">{scoreText(row.scorePct)}</span>
            </p>
            {step?.nextPct != null && (
              <p className="text-sm font-semibold text-muted-foreground">Next stop {step.nextPct}%</p>
            )}
          </div>
        )}
        {step && (
          <div className="mt-1.5 h-2.5 rounded-full bg-secondary overflow-hidden" aria-hidden>
            <div className={cn("h-full rounded-full", STEP_BAR[step.key])} style={{ width: `${fill}%` }} />
          </div>
        )}
        <p className="text-sm text-muted-foreground mt-1.5">{scoreDetail(row)}</p>
        {step && (
          <p className={cn("mt-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold", STEP_PILL[step.key])}>
            {step.key === "legend" && <Sparkles className="w-4 h-4" />}
            {step.message}
          </p>
        )}
      </div>
    </div>
  );
}
