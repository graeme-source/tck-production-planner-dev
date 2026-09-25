/**
 * "Hours worked" on a person's record (Graeme, 2026-09-25; Objective I):
 * average shift, paid hours a week against their contracted hours, typical
 * start and finish, a weekday table and a weekly bar chart — so it's plain
 * whether someone works under or over their contract. Weeks with holiday,
 * sickness or absence are marked and left out of the average.
 *
 * Data: GET /api/people/:userId/hours (People access + private PIN; hours
 * only, never pay). Loaded on its own so a slow Planday never holds up the
 * rest of the record.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Clock3, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { peopleFetch, peopleRetry } from "@/hooks/use-people-gate";
import { useCanManageContracts } from "@/components/person-contracts";
import { HoursRangePicker, defaultHoursRange, type HoursRange } from "@/components/hours-range-picker";
import { HoursWeekChart } from "@/components/hours-week-chart";
import { fmtDay } from "@/lib/people-api";
import {
  CONTRACT_SOURCE_LABEL, WEEKDAY_NAMES, fmtHm, fmtHours, fmtSigned, weekNote,
  type PersonHoursResponse, type HoursReport, type ContractedHours,
} from "@/lib/hours-worked-view";

function BigTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "over" | "under" | "on" | null }) {
  return (
    <div className={cn(
      "rounded-2xl border-2 p-4",
      tone === "under" ? "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30"
        : tone === "over" || tone === "on" ? "border-primary/50 bg-primary/5"
        : "border-border bg-card",
    )}>
      <p className="text-sm font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("text-3xl sm:text-4xl font-display font-bold mt-1 tabular-nums leading-tight",
        tone === "under" && "text-amber-800 dark:text-amber-200")}>{value}</p>
      {sub && <p className="text-sm text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function ContractLine({ contract, canContracts }: { contract: ContractedHours; canContracts: boolean }) {
  if (contract.hours != null && contract.source) {
    return (
      <p className="text-sm text-muted-foreground">
        Contracted hours: {CONTRACT_SOURCE_LABEL[contract.source]}
        {contract.sourceText ? ` ("${contract.sourceText}")` : ""}
        {contract.sourceDate ? `, ${fmtDay(contract.sourceDate, true)}` : ""}.
        {contract.notes.length > 0 && ` ${contract.notes.join(" ")}`}
      </p>
    );
  }
  return (
    <div className="rounded-2xl bg-secondary/40 p-3 space-y-1">
      <p className="text-base font-bold">No contracted hours on file</p>
      <p className="text-sm text-muted-foreground">
        {canContracts ? (
          <>Issue them a contract from the{" "}
            <Link href="/founder/contracts" className="font-bold text-primary underline">contract issuer</Link>
            {" "}(it states weekly hours), or set a contract rule on their Planday profile.</>
        ) : (
          <>Set a contract rule on their Planday profile, or ask Graeme to issue a contract with their weekly hours.</>
        )}
        {contract.notes.length > 0 && ` ${contract.notes.join(" ")}`}
      </p>
    </div>
  );
}

function ReportBody({ report, contract, canContracts }: { report: HoursReport; contract: ContractedHours; canContracts: boolean }) {
  const excluded = report.leaveWeeks + report.otherExcludedWeeks;
  const [showWeeks, setShowWeeks] = useState(false);
  if (report.shifts === 0) {
    return (
      <div className="space-y-3">
        <p className="text-base text-muted-foreground py-2">No approved shifts in Planday for this range.</p>
        <ContractLine contract={contract} canContracts={canContracts} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <BigTile label="Average shift" value={fmtHm(report.avgClockHours)} sub={`Start to finish · ${fmtHm(report.avgPaidHours)} paid`} />
        <BigTile label="Paid hours a week" value={fmtHours(report.avgPaidPerWeek)}
          sub={report.countedWeeks > 0 ? `Average of ${report.countedWeeks} full week${report.countedWeeks === 1 ? "" : "s"}` : "No full weeks to average yet"} />
        <BigTile label="Contracted" value={contract.hours != null ? fmtHours(contract.hours) : "—"} sub={contract.hours != null ? "a week (minimum)" : "Not on file"} />
        <BigTile label="Difference"
          value={report.difference == null ? "—" : report.standing === "on" ? "On contract" : `${fmtSigned(report.difference)} h`}
          sub={report.difference == null
            ? contract.hours == null ? "Needs contracted hours" : "Needs a full week"
            : report.standing === "on" ? "Within half an hour a week" : `a week ${report.standing} contract`}
          tone={report.standing} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-secondary/40 p-3">
          <p className="text-sm font-bold text-muted-foreground">Typical day</p>
          <p className="text-2xl font-bold tabular-nums">{report.typicalStart ?? "—"} – {report.typicalFinish ?? "—"}</p>
        </div>
        <div className="rounded-2xl bg-secondary/40 p-3">
          <p className="text-sm font-bold text-muted-foreground">Approved shifts</p>
          <p className="text-2xl font-bold tabular-nums">{report.shifts}</p>
        </div>
        <div className="rounded-2xl bg-secondary/40 p-3">
          <p className="text-sm font-bold text-muted-foreground">Total paid</p>
          <p className="text-2xl font-bold tabular-nums">{fmtHours(report.totalPaidHours)}</p>
        </div>
      </div>

      <ContractLine contract={contract} canContracts={canContracts} />

      <div className="space-y-2">
        <h3 className="text-lg font-bold">Paid hours each week</h3>
        <HoursWeekChart weeks={report.weeks} contracted={contract.hours} />
        <p className="text-sm text-muted-foreground">
          {excluded > 0
            ? `${excluded} week${excluded === 1 ? "" : "s"} left out of the weekly average${report.leaveWeeks > 0 ? ` — ${report.leaveWeeks} with holiday, sickness or absence, so a short week isn't counted as under` : ""}${report.otherExcludedWeeks > 0 ? `${report.leaveWeeks > 0 ? ";" : " —"} ${report.otherExcludedWeeks} part week${report.otherExcludedWeeks === 1 ? "" : "s"} (the range edges, this week, or before they started)` : ""}.`
            : "Every week in the range is counted."}
          {report.leaveShifts > 0 && ` ${report.leaveShifts} holiday/sickness shift${report.leaveShifts === 1 ? "" : "s"} in Planday aren't counted as hours worked.`}
        </p>
        <button onClick={() => setShowWeeks(v => !v)} aria-expanded={showWeeks}
          className="h-12 px-4 rounded-2xl border-2 border-border text-base font-bold hover:bg-secondary/50">
          {showWeeks ? "Hide the weeks list" : "Show the weeks as a list"}
        </button>
        {showWeeks && (
          <ul className="divide-y divide-border rounded-2xl border-2 border-border">
            {report.weeks.map(w => (
              <li key={w.weekStart} className="flex items-center gap-3 px-4 py-3 text-base">
                <span className="w-28 shrink-0 font-semibold">{fmtDay(w.weekStart)}</span>
                <span className="w-20 shrink-0 tabular-nums font-bold">{fmtHours(w.paidHours)}</span>
                <span className="flex-1 min-w-0 text-muted-foreground text-sm">
                  {w.shifts} shift{w.shifts === 1 ? "" : "s"}{weekNote(w) ? ` · ${weekNote(w)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-lg font-bold">By day of the week</h3>
        <div className="rounded-2xl border-2 border-border overflow-hidden">
          <table className="w-full text-base">
            <thead className="bg-secondary/40 text-sm text-muted-foreground">
              <tr>
                <th className="text-left font-bold px-3 py-2">Day</th>
                <th className="text-right font-bold px-3 py-2">Shifts</th>
                <th className="text-right font-bold px-3 py-2">Avg paid</th>
                <th className="text-right font-bold px-3 py-2 hidden sm:table-cell">Typical</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.weekdays.filter(d => d.shifts > 0 || d.weekday <= 5).map(d => (
                <tr key={d.weekday} className={cn(d.shifts === 0 && "text-muted-foreground")}>
                  <td className="px-3 py-2.5 font-semibold">{WEEKDAY_NAMES[d.weekday - 1]}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{d.shifts}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold">{fmtHm(d.avgPaidHours)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums hidden sm:table-cell">{d.typicalStart ? `${d.typicalStart}–${d.typicalFinish}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function PersonHoursPanel({ userId, ready }: { userId: number; ready: boolean }) {
  const [range, setRange] = useState<HoursRange>(defaultHoursRange);
  const canContracts = useCanManageContracts();
  const { data, isLoading, isFetching, error, refetch } = useQuery<PersonHoursResponse>({
    queryKey: ["people-hours", userId, range.from, range.to],
    queryFn: () => peopleFetch<PersonHoursResponse>(`/people/${userId}/hours?from=${range.from}&to=${range.to}`),
    enabled: ready,
    retry: peopleRetry,
    staleTime: 5 * 60 * 1000,
    // Keep the last answer on screen while a new range loads — this person only.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === userId ? prev : undefined),
  });

  let body: React.ReactNode;
  if (!ready || (isLoading && !data)) {
    body = <div className="flex items-center gap-3 py-6 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Adding up approved shifts from Planday…</div>;
  } else if (error || !data) {
    body = (
      <div className="flex items-center gap-3 flex-wrap py-2">
        <p className="flex-1 min-w-0 text-base text-muted-foreground">{error instanceof Error ? error.message : "Couldn't load hours."}</p>
        <button onClick={() => void refetch()} className="h-12 px-4 rounded-xl border-2 border-border font-bold flex items-center gap-2 hover:bg-secondary/50">
          <RefreshCw className="w-4 h-4" /> Try again
        </button>
      </div>
    );
  } else if (data.status === "not_linked") {
    body = (
      <div className="space-y-3">
        <p className="text-base text-muted-foreground py-2">Not linked to a Planday employee yet, so there are no shifts to add up — link them from Analytics → Employee Records.</p>
        <ContractLine contract={data.contract} canContracts={canContracts} />
      </div>
    );
  } else if (data.status === "not_configured") {
    body = <p className="text-base text-muted-foreground py-2">Planday isn't connected on this server.</p>;
  } else if (data.status === "unreachable" || !data.report) {
    body = (
      <div className="flex items-center gap-3 flex-wrap py-2">
        <p className="flex-1 min-w-0 text-base text-muted-foreground">Couldn't reach Planday — try again.</p>
        <button onClick={() => void refetch()} disabled={isFetching} className="h-12 px-4 rounded-xl border-2 border-border font-bold flex items-center gap-2 hover:bg-secondary/50">
          <RefreshCw className="w-4 h-4" /> Try again
        </button>
      </div>
    );
  } else {
    body = (
      <>
        <ReportBody report={data.report} contract={data.contract} canContracts={canContracts} />
        <p className="text-sm text-muted-foreground">
          {fmtDay(data.range.from, true)} to {fmtDay(data.range.to, true)}. Approved Planday shifts: paid hours are start to finish minus unpaid breaks. Everyone is paid for every hour worked; the contract is their minimum.
          {data.attendanceStale && " Couldn't reach Planday for the latest holiday and sickness — leave shown as last synced."}
        </p>
      </>
    );
  }

  return (
    <section className="rounded-3xl border-2 border-border bg-card p-4 sm:p-5 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-xl font-bold flex items-center gap-2 flex-1 min-w-0"><Clock3 className="w-5 h-5 text-primary" /> Hours worked</h2>
        {isFetching && data && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-label="Updating" />}
      </div>
      <HoursRangePicker value={range} onChange={setRange} />
      {body}
    </section>
  );
}
