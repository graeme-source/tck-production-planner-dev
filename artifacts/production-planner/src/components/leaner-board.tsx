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
  SCORE_EXPLAINER, SCORE_SMALL_PRINT, leanerStep, scoreDetail, scoreText,
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
      {/* A leaderboard table, one row each, most improvements at the top
          (Graeme, 2026-10-13: "condense this back down into something more
          of a table… score, percentage and number of improvements all on one
          line… get rid of the progress bar"). The server sends it in order. */}
      <div className="rounded-2xl border-2 border-border bg-card overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 w-10 text-center">#</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2 text-right">Improvements</th>
              <th className="px-3 py-2 text-right">Score</th>
              <th className="px-3 py-2 hidden md:table-cell">Next step</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => <LeanerRow key={row.userId ?? row.name} row={row} rank={i + 1} />)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const MEDAL = ["🥇", "🥈", "🥉"];

function LeanerRow({ row, rank }: { row: LeanerBoardRow; rank: number }) {
  const step = leanerStep(row);
  return (
    <tr className="border-t border-border align-middle">
      <td className="px-3 py-2.5 text-center text-lg font-bold tabular-nums text-muted-foreground">
        {rank <= 3 && row.improvements30 > 0 ? MEDAL[rank - 1] : rank}
      </td>
      <td className="px-3 py-2.5 min-w-0">
        <p className="text-base font-bold truncate">{row.name}</p>
        <p className="text-xs text-muted-foreground">{row.count} all-time</p>
      </td>
      {/* The main figure: improvements in the last 30 days. */}
      <td className={cn("px-3 py-2.5 text-right text-2xl font-extrabold tabular-nums", row.improvements30 > 0 ? "text-primary" : "text-muted-foreground")}>
        {row.improvements30}
      </td>
      {/* No shifts to divide by = no % at all, just why. */}
      <td className="px-3 py-2.5 text-right" title={scoreDetail(row)}>
        {row.scorePct != null ? (
          <>
            <p className="text-xl font-extrabold tabular-nums">{scoreText(row.scorePct)}</p>
            <p className="text-xs text-muted-foreground tabular-nums">{row.shifts30 ?? 0} shifts</p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">{scoreDetail(row)}</p>
        )}
      </td>
      <td className="px-3 py-2.5 hidden md:table-cell">
        {step && (
          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold", STEP_PILL[step.key])}>
            {step.key === "legend" && <Sparkles className="w-3.5 h-3.5" />}
            {step.message}
          </span>
        )}
      </td>
    </tr>
  );
}
