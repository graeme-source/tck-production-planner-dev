/**
 * Probation on a person's record: start → end, and Extend / Passed / Not
 * passed. If nothing has been set, the dates are worked out from their
 * contract start + probation length (new starters only) and can be set by
 * hand. Each decision also lands on the record as a Probation review entry.
 */
import { useState } from "react";
import { GraduationCap } from "lucide-react";
import { fmtDayIso, periodEnd, PERIOD_MONTHS } from "@workspace/people-reviews";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { recordSend, type PersonRecordEntries } from "./reviews-api";

export function ProbationCard({ data, onChanged }: { data: PersonRecordEntries; onChanged: () => void }) {
  const p = data.probation;
  const [mode, setMode] = useState<null | "extend" | "set">(null);
  const [start, setStart] = useState(p?.startDate ?? data.today);
  const [months, setMonths] = useState(6);
  const [busy, setBusy] = useState(false);
  const post = async (body: unknown, done: string) => {
    setBusy(true);
    try { await recordSend("POST", `/person/${data.person.id}/probation`, body); toast({ title: done }); setMode(null); onChanged(); }
    catch (e) { toast({ title: "Couldn't save that", description: e instanceof Error ? e.message : "Try again", variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const btn = "min-h-12 px-4 rounded-xl border-2 border-border font-bold hover:bg-secondary/50 disabled:opacity-50";

  return (
    <section className="rounded-3xl border-2 border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <GraduationCap className="w-5 h-5 text-primary" />
        <h3 className="flex-1 min-w-0 text-lg font-bold">Probation</h3>
        {p?.outcome && (
          <span className={cn("text-sm font-bold px-2.5 py-1 rounded-lg", p.outcome === "passed" ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200" : "bg-rose-100 text-rose-900")}>
            {p.outcome === "passed" ? "Passed" : "Not passed"}
          </span>
        )}
      </div>
      <p className="text-base">
        {p ? <>{fmtDayIso(p.startDate)} → {fmtDayIso(p.endDate)}{p.derived ? <span className="text-muted-foreground"> (from their contract)</span> : null}</> : <span className="text-muted-foreground">No probation dates set.</span>}
      </p>
      {mode === null && (
        <div className="flex flex-wrap gap-2">
          {p && !p.outcome && <button type="button" disabled={busy} className={btn} onClick={() => void post({ action: "passed" }, "Probation passed")}>Mark passed</button>}
          {p && <button type="button" className={btn} onClick={() => setMode("extend")}>Extend</button>}
          {p && !p.outcome && <button type="button" disabled={busy} className={btn} onClick={() => void post({ action: "not_passed" }, "Recorded: not passed")}>Not passed</button>}
          <button type="button" className={btn} onClick={() => setMode("set")}>{p ? "Change dates" : "Set dates"}</button>
        </div>
      )}
      {mode === "extend" && (
        <div className="flex flex-wrap gap-2">
          {PERIOD_MONTHS.map(m => (
            <button key={m} type="button" disabled={busy} className={btn} onClick={() => void post({ action: "extend", months: m }, `Probation extended by ${m} month${m === 1 ? "" : "s"}`)}>+{m} month{m === 1 ? "" : "s"}</button>
          ))}
          <button type="button" className={btn} onClick={() => setMode(null)}>Cancel</button>
        </div>
      )}
      {mode === "set" && (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-base font-bold">Started</span>
              <input type="date" value={start} onChange={e => setStart(e.target.value)} className="w-full h-14 rounded-2xl border-2 border-border bg-card px-4 text-lg font-bold" />
            </label>
            <label className="block space-y-1">
              <span className="text-base font-bold">Length (months)</span>
              <select value={months} onChange={e => setMonths(Number(e.target.value))} className="w-full h-14 rounded-2xl border-2 border-border bg-card px-4 text-lg font-bold">
                {[1, 2, 3, 4, 6, 9, 12].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          </div>
          <p className="text-base">Ends {fmtDayIso(periodEnd(start, months))}</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} className={cn(btn, "bg-primary text-primary-foreground border-primary")} onClick={() => void post({ action: "set", startDate: start, months }, "Probation dates saved")}>Save dates</button>
            <button type="button" className={btn} onClick={() => setMode(null)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
