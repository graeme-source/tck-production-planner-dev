/**
 * The Leaner-board (Objectives E and H). Ranked by improvement score —
 * credits ÷ shifts worked over the last 30 days, one improvement per shift
 * = 100% — not by who has logged the most (Graeme, 2026-10-12). The score
 * is the big number; the all-time count stays in the small print.
 *
 * Shown on the Improvements page, which is also the morning meeting's
 * Improvements slide, so both carry it.
 */
import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { SCORE_EXPLAINER, scoreBand, scoreBarFill, scoreDetail, scoreText } from "@/lib/improvement-score";

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

const BAND_BAR: Record<ReturnType<typeof scoreBand>, string> = {
  none: "bg-muted",
  under: "bg-amber-500",
  on: "bg-emerald-500",
  above: "bg-emerald-600",
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
      </div>
      {legacy > 0 && (
        <p className="text-sm text-muted-foreground -mt-1">
          All-time counts include {legacy} completed before sign-off existed — those were never
          approved by anyone.
        </p>
      )}
      {/* One list, best score at the top — not columns (Graeme, 2026-09-25).
          The server sends it already in order. */}
      <div className="rounded-2xl border-2 border-border bg-card overflow-hidden">
        {data.map((row, i) => (
          <div
            key={row.userId ?? row.name}
            className={cn("px-4 py-3.5 min-w-0", i > 0 && "border-t border-border")}
          >
            <div className="flex items-center justify-between gap-3 min-w-0">
              <div className="min-w-0">
                <p className="text-lg font-bold truncate">{row.name}</p>
                <p className="text-sm text-muted-foreground truncate">{scoreDetail(row)}</p>
              </div>
              <span
                className={cn("text-3xl font-extrabold tabular-nums flex-shrink-0", row.scorePct == null && "text-muted-foreground")}
                title={row.scorePct == null
                  ? (row.shifts30 == null ? "Not linked to Planday, so we can't count their shifts" : "No shifts worked in the last 30 days")
                  : `${row.credits30} credits over ${row.shifts30} shifts`}
              >
                {scoreText(row.scorePct)}
              </span>
            </div>
            {row.scorePct != null && (
              <div className="mt-2 h-2.5 rounded-full bg-secondary overflow-hidden relative" aria-hidden>
                <div
                  className={cn("h-full rounded-full", BAND_BAR[scoreBand(row.scorePct)])}
                  style={{ width: `${scoreBarFill(row.scorePct)}%` }}
                />
                {/* The 100% mark — one a shift — halfway along the bar. */}
                <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-foreground/40" />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
