/**
 * "Hours vs contract" on the People list (Graeme, 2026-09-25; Objective I):
 * everyone active, their average paid hours a week against their contracted
 * hours, biggest gap first — who's under or over at a glance. Tap a row for
 * the full "Hours worked" report on their record.
 *
 * Data: GET /api/people/hours (People access + private PIN; hours only).
 * The server reads Planday payroll once per 28-day block for everyone.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { peopleFetch, peopleRetry, PeopleLockedError } from "@/hooks/use-people-gate";
import { UserAvatar } from "@/components/user-avatar";
import { PeopleLockedCard } from "@/components/people-locked-card";
import { HoursRangePicker, defaultHoursRange, type HoursRange } from "@/components/hours-range-picker";
import { fmtDay } from "@/lib/people-api";
import {
  CONTRACT_SOURCE_LABEL, fmtDifference, fmtHours, fmtSigned, type TeamHoursResponse, type TeamHoursRow,
} from "@/lib/hours-worked-view";

function Row({ r }: { r: TeamHoursRow }) {
  const tone = r.standing;
  return (
    <Link
      href={`/people/${r.id}`}
      className={cn(
        "flex items-center gap-4 rounded-3xl border-2 bg-card p-4 transition-all active:scale-[0.995] hover:border-primary/50",
        tone === "under" ? "border-amber-400/80 dark:border-amber-700" : "border-border",
      )}
    >
      <UserAvatar name={r.name} avatarUrl={r.avatarUrl} size="lg" />
      <div className="flex-1 min-w-0">
        <p className="text-xl font-bold leading-snug truncate">{r.name}</p>
        <p className="text-base text-muted-foreground">
          {r.avgPaidPerWeek != null ? <><span className="font-bold text-foreground tabular-nums">{fmtHours(r.avgPaidPerWeek)}</span> a week</> : r.linkedToPlanday ? "No shifts in this range" : "Not linked to Planday"}
          {" · "}
          {r.contractedHours != null
            ? <span title={r.contractSource ? CONTRACT_SOURCE_LABEL[r.contractSource] : undefined}>contract <span className="font-bold text-foreground tabular-nums">{fmtHours(r.contractedHours)}</span></span>
            : "no contracted hours on file"}
        </p>
        {r.leaveWeeks > 0 && r.avgPaidPerWeek != null && (
          <p className="text-sm text-muted-foreground">{r.leaveWeeks} week{r.leaveWeeks === 1 ? "" : "s"} with leave left out</p>
        )}
      </div>
      {r.difference != null && (
        <span className={cn(
          "shrink-0 text-right rounded-2xl px-3 py-2 font-bold tabular-nums",
          tone === "under" ? "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
            : tone === "over" ? "bg-primary/10 text-primary"
            : "bg-secondary text-muted-foreground",
        )}>
          <span className="block text-2xl leading-tight">{tone === "on" ? "On" : `${fmtSigned(r.difference)} h`}</span>
          <span className="block text-xs font-semibold">{tone === "on" ? "contract" : tone === "over" ? "a week over" : "a week under"}</span>
          <span className="sr-only">{fmtDifference(r.difference, r.standing)}</span>
        </span>
      )}
      <ChevronRight className="w-6 h-6 text-muted-foreground shrink-0" />
    </Link>
  );
}

export function TeamHoursView({ ready }: { ready: boolean }) {
  const [range, setRange] = useState<HoursRange>(defaultHoursRange);
  const { data, isLoading, isFetching, error, refetch } = useQuery<TeamHoursResponse>({
    queryKey: ["people-hours-team", range.from, range.to],
    queryFn: () => peopleFetch<TeamHoursResponse>(`/people/hours?from=${range.from}&to=${range.to}`),
    enabled: ready,
    retry: peopleRetry,
    staleTime: 5 * 60 * 1000,
    placeholderData: prev => prev,
  });

  if (error instanceof PeopleLockedError) return <PeopleLockedCard error={error} />;

  const withContract = data?.rows.filter(r => r.difference != null) ?? [];
  const under = withContract.filter(r => r.standing === "under").length;
  const over = withContract.filter(r => r.standing === "over").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0"><HoursRangePicker value={range} onChange={setRange} /></div>
        {isFetching && data && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground shrink-0" aria-label="Updating" />}
      </div>

      {!ready || (isLoading && !data) ? (
        <div className="flex items-center justify-center gap-3 py-16 text-lg text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /> Adding up everyone's shifts from Planday…</div>
      ) : error || !data ? (
        <div className="p-5 rounded-2xl bg-destructive/10 text-destructive text-lg font-semibold">{error instanceof Error ? error.message : "Couldn't load hours."}</div>
      ) : data.status !== "ok" ? (
        <div className="flex items-center gap-3 flex-wrap rounded-2xl border-2 border-border p-4">
          <p className="flex-1 min-w-0 text-base text-muted-foreground">
            {data.status === "not_configured" ? "Planday isn't connected on this server." : "Couldn't reach Planday — try again."}
          </p>
          {data.status === "unreachable" && (
            <button onClick={() => void refetch()} className="h-12 px-4 rounded-xl border-2 border-border font-bold flex items-center gap-2 hover:bg-secondary/50">
              <RefreshCw className="w-4 h-4" /> Try again
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-3 grid-cols-3">
            <div className="rounded-2xl border-2 border-amber-400/70 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/20 p-3">
              <p className="text-sm font-bold text-muted-foreground">Under contract</p>
              <p className="text-3xl font-display font-bold tabular-nums">{under}</p>
            </div>
            <div className="rounded-2xl border-2 border-primary/40 bg-primary/5 p-3">
              <p className="text-sm font-bold text-muted-foreground">Over contract</p>
              <p className="text-3xl font-display font-bold tabular-nums">{over}</p>
            </div>
            <div className="rounded-2xl border-2 border-border p-3">
              <p className="text-sm font-bold text-muted-foreground">No contracted hours</p>
              <p className="text-3xl font-display font-bold tabular-nums">{data.sources.none}</p>
            </div>
          </div>
          <div className="grid gap-3">
            {data.rows.map(r => <Row key={r.id} r={r} />)}
          </div>
          <p className="text-sm text-muted-foreground">
            {fmtDay(data.range.from, true)} to {fmtDay(data.range.to, true)}. Average paid hours over full weeks from approved Planday shifts;
            weeks with holiday, sickness or absence, part weeks and this week are left out, so a short week isn't counted as under.
            Within half an hour a week counts as on contract. Contracted hours come from an issued contract ({data.sources.issued_contract}),
            a Planday contract rule ({data.sources.planday_rule}) or an uploaded contract ({data.sources.uploaded_contract}).
            {data.attendanceStale && " Couldn't reach Planday for the latest holiday and sickness — leave shown as last synced."}
          </p>
        </>
      )}
    </div>
  );
}
