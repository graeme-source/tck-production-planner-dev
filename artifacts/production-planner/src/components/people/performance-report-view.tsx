/**
 * The performance review data report (Graeme, 24 Nov 2026) — big overview
 * cards that open into the detail. Used on the manager's review page and,
 * read-only, for the employee once a saved copy is shared with them. Shows
 * only what the system records; "Nothing recorded in the system" never
 * becomes "none".
 */
import { useState, type ReactNode } from "react";
import {
  Lightbulb, GraduationCap, BookOpen, Gauge, CalendarCheck, FileText, Users, ChevronDown, ChevronUp, Info, ListChecks, StickyNote, Lock, ClipboardPlus,
} from "lucide-react";
import { itemKey, noteAsText, noteTitle, NOTE_KIND_LABELS, type Exclusions, type PerformanceReport, type RateStat, type ReportNote } from "@workspace/performance-review";
import { cn } from "@/lib/utils";

type CardKey = "improvements" | "training" | "lean" | "speed" | "checklists" | "attendance" | "records" | "contributions" | "notes";

const fmtDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtShort = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const fmtMonth = (ym: string) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
const pl = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const STATION_NAMES: Record<string, string> = {
  prep_meat: "Raw Meat", prep: "Prep", mixing: "Mixing", building_1: "Building 1", building_2: "Building 2", building: "Building",
  wrapping: "Wrapping", packing: "Packing", ovens: "Ovens", sheeting: "Sheeting", dough: "Dough", mac_cheese: "Mac cheese",
};
const stationName = (s: string) => STATION_NAMES[s] ?? s.replace(/_/g, " ").replace(/^./, c => c.toUpperCase());

/** Unticking things while going through the report together (24 Nov 2026):
 *  `original` is the full report, `report` the one with them left out. */
export interface ReportEditing {
  original: PerformanceReport;
  ex: Exclusions;
  toggleSection: (section: string) => void;
  toggleItem: (key: string) => void;
  /** Copy text into the manager's private prep notes. */
  addToPrep?: (text: string) => void;
}

/** Which card is which section. */
const sectionOf = (c: { key: CardKey; id?: string }) => (c.id?.startsWith("speed-") ? `speed_${c.id.slice(6)}` : c.key);

export function PerformanceReportView({ report, audience, editing, onNotesCard }: {
  report: PerformanceReport; audience: "manager" | "employee"; editing?: ReportEditing;
  /** When the notes are shown elsewhere on the page (beside the prep notes),
   *  their card takes you there instead of opening underneath. */
  onNotesCard?: () => void;
}) {
  const [open, setOpen] = useState<CardKey | null>(null);
  const r = report;
  const toggle = (k: CardKey) => (k === "notes" && onNotesCard ? onNotesCard() : setOpen(o => (o === k ? null : k)));

  const stationsWorked = r.training.stations.filter(s => s.worksThere);
  const sopsAtStations = stationsWorked.reduce((n, s) => n + s.sopCount, 0);
  const sopsTrained = stationsWorked.reduce((n, s) => n + s.trained, 0);
  const leanPct = r.lean.weeksAssigned > 0 ? Math.round((r.lean.weeksCompleted / r.lean.weeksAssigned) * 100) : null;

  const cards: Array<{ key: CardKey; id?: string; icon: typeof Users; title: string; big: string; sub: string; tone?: "good" | "warn" | null }> = [
    (() => {
      // The CURRENT score leads — last 30 days, exactly as the improvements
      // leaderboard shows it — then the whole period and the count (Graeme,
      // 24 Nov 2026: "the important thing is to look at the current score").
      const imp = r.improvements;
      const cur = imp.current?.scorePct != null ? imp.current : null;
      const headline = cur ? cur.scorePct : imp.scorePct ?? null;
      return {
        key: "improvements" as CardKey, icon: Lightbulb, title: headline != null ? "Improvement score" : "Improvements",
        big: headline != null ? `${headline}%` : String(imp.completed),
        sub: headline != null
          ? [cur ? "last 30 days · aim 100%" : "this period · aim 100%",
             cur && imp.scorePct != null ? `period ${imp.scorePct}%` : null,
             pl(imp.completed, "improvement") + " in the period",
             cur?.teamAveragePct != null ? `team avg ${cur.teamAveragePct}%` : imp.teamScorePct != null ? `team ${imp.teamScorePct}%` : null,
            ].filter(Boolean).join(" · ")
          : `${pl(imp.completed, "improvement")}${imp.teamAverage != null ? ` · team average ${imp.teamAverage}` : ""}`,
        tone: headline == null ? (imp.teamAverage == null ? null : imp.completed >= imp.teamAverage ? "good" as const : "warn" as const)
          : headline >= 100 ? "good" as const : "warn" as const,
      };
    })(),
    {
      key: "training", icon: GraduationCap, title: "Training",
      big: sopsAtStations > 0 ? `${sopsTrained}/${sopsAtStations}` : "—",
      sub: sopsAtStations > 0 ? `SOPs trained at ${pl(stationsWorked.length, "station")} they work` : "No stations from the rota in this period",
      tone: sopsAtStations === 0 ? null : sopsTrained === sopsAtStations ? "good" : "warn",
    },
    {
      key: "lean", icon: BookOpen, title: "Lean curriculum",
      big: r.lean.weeksAssigned > 0 ? `${r.lean.weeksCompleted}/${r.lean.weeksAssigned}` : "—",
      sub: leanPct != null ? `weeks completed (${leanPct}%)` : "No weekly lessons set in this period",
      tone: leanPct == null ? null : leanPct >= 90 ? "good" : "warn",
    },
    // Three speeds, three cards — one figure each (Graeme: "separate them
    // into three distinct KPIs"). Each opens the same speed detail.
    ...(([["building", "Building speed"], ["wrapping", "Wrapping speed"], ["packing", "Packing speed"]] as const).map(([k, title]) => {
      const sp = r.speed[k];
      const vs = sp?.standard ?? null;
      return {
        key: "speed" as CardKey, id: `speed-${k}`, icon: Gauge, title,
        big: sp?.overall != null ? String(sp.overall) : "—",
        sub: sp ? `${sp.unit} · ${pl(sp.days, "day")}${vs != null ? ` · standard ${vs}` : ""}` : "Nothing recorded against them",
        tone: sp?.overall == null || vs == null ? null : sp.overall >= vs ? "good" as const : sp.overall < vs * 0.9 ? "warn" as const : null,
      };
    })),
    {
      key: "checklists", icon: ListChecks, title: "Checklists",
      big: r.checklists?.known ? String(r.checklists.missed) : "—",
      sub: r.checklists?.known
        ? `${r.checklists.missed === 1 ? "item" : "items"} left unticked on ${pl(r.checklists.stationDays, "station day")} they worked`
        : "No rostered station days to check against",
      tone: !r.checklists?.known ? null : r.checklists.missed === 0 ? "good" : "warn",
    },
    {
      key: "attendance", icon: CalendarCheck, title: "Attendance",
      big: r.attendance.known && r.attendance.attendancePct != null ? `${r.attendance.attendancePct}%` : "—",
      sub: r.attendance.known ? `${pl(r.attendance.sickInstances, "sickness absence")} · ${pl(r.attendance.lates, "late")}` : "Not linked to Planday",
      tone: !r.attendance.known ? null : r.attendance.sickInstances >= 3 || r.attendance.lates >= 4 ? "warn" : "good",
    },
    {
      key: "records", icon: FileText, title: "On the record",
      big: String(r.records.disciplinary.length + r.records.attendanceOrTimekeeping.length + r.records.praise.length),
      sub: `${pl(r.records.praise.length, "praise")} · ${r.records.disciplinary.length ? pl(r.records.disciplinary.length, "disciplinary entry", "disciplinary entries") : "disciplinary: nothing recorded in the system"}`,
    },
    {
      key: "contributions", icon: Users, title: "Contributions",
      big: String(r.contributions.factoryReports + r.contributions.appReports + r.contributions.sopsWritten),
      sub: `${pl(r.contributions.factoryReports + r.contributions.appReports, "problem reported", "problems reported")} · ${pl(r.contributions.sopsWritten, "SOP")} written`,
    },
    // Notes on their record for the period (Graeme, 24 Nov 2026). Older
    // saved copies don't have them.
    ...(r.notes ? [{
      key: "notes" as CardKey, icon: StickyNote, title: "Notes on the record",
      big: String(r.notes.fromLastReview.length + r.notes.list.length),
      sub: [
        r.notes.lastReview ? `${pl(r.notes.fromLastReview.length, "objective or agreement", "objectives and agreements")} from the last review` : null,
        `${pl(r.notes.list.length, "note")} in the period`,
      ].filter(Boolean).join(" · "),
    }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.filter(c => editing || !(r.hiddenSections ?? []).includes(sectionOf(c))).map(c => {
          const section = sectionOf(c);
          const left = editing ? editing.ex.sections.includes(section) : false;
          return (
          <div key={c.id ?? c.key} className={cn(
            "rounded-2xl border-2 flex flex-col transition-colors",
            open === c.key ? "border-primary bg-primary/5" : "border-border bg-card",
            left && "opacity-50",
          )}>
          <button
            type="button"
            onClick={() => toggle(c.key)}
            aria-expanded={open === c.key}
            className="text-left rounded-2xl p-4 min-h-[8.5rem] flex flex-col gap-1 hover:bg-secondary/40 flex-1"
          >
            <span className="flex items-center justify-between gap-2 text-sm font-semibold text-muted-foreground">
              <span className="flex items-center gap-1.5"><c.icon className="w-4 h-4" /> {c.title}</span>
              {open === c.key ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </span>
            <span className={cn("text-3xl font-display font-bold tabular-nums", left && "line-through",
              c.tone === "good" && "text-emerald-700 dark:text-emerald-400", c.tone === "warn" && "text-amber-700 dark:text-amber-400")}>{c.big}</span>
            <span className="text-sm text-muted-foreground leading-snug">{c.sub}</span>
          </button>
          {editing && (
            <label className="flex items-center gap-2 px-4 pb-3 -mt-1 text-xs font-medium text-muted-foreground cursor-pointer min-h-8">
              <input type="checkbox" checked={!left} onChange={() => editing.toggleSection(section)} className="w-4 h-4 accent-[#7cb342]" />
              {left ? "Left out of the report" : "In the report"}
            </label>
          )}
          </div>
          );
        })}
      </div>

      {open && (
        <section className="rounded-2xl border-2 border-primary/30 bg-card p-4 sm:p-5">
          {open === "improvements" && <ImprovementsDetail r={r} />}
          {open === "training" && <TrainingDetail r={r} editing={editing} />}
          {open === "lean" && <LeanDetail r={r} editing={editing} />}
          {open === "speed" && <SpeedDetail r={r} />}
          {open === "checklists" && <ChecklistsDetail r={r} editing={editing} />}
          {open === "attendance" && <AttendanceDetail r={r} editing={editing} />}
          {open === "records" && <RecordsDetail r={r} audience={audience} editing={editing} />}
          {open === "contributions" && <ContributionsDetail r={r} />}
          {open === "notes" && <NotesDetail r={r} audience={audience} editing={editing} />}
        </section>
      )}
    </div>
  );
}

/** The tick beside an item that can be left out (manager, live report only). */
function ItemTick({ editing, k }: { editing?: ReportEditing; k: string }) {
  if (!editing) return null;
  const left = editing.ex.items.includes(k);
  return (
    <label className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground cursor-pointer" title={left ? "Left out — tick to put it back" : "Untick to leave it out of the report"}>
      <input type="checkbox" checked={!left} onChange={() => editing.toggleItem(k)} className="w-4 h-4 accent-[#7cb342]" />
      <span className="sr-only">{left ? "Left out" : "In the report"}</span>
    </label>
  );
}
const isLeft = (editing: ReportEditing | undefined, k: string) => !!editing?.ex.items.includes(k);
const leftClass = (on: boolean) => (on ? "line-through opacity-50" : "");

function H({ children }: { children: ReactNode }) {
  return <h3 className="text-lg font-display font-bold mb-3">{children}</h3>;
}
function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground flex items-start gap-1.5 mt-3"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span>{children}</span></p>;
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground rounded-xl bg-secondary/40 px-3 py-2.5">{children}</p>;
}

function ImprovementsDetail({ r }: { r: PerformanceReport }) {
  const max = Math.max(1, ...r.improvements.monthly.map(m => m.completed));
  return (
    <div>
      <H>
        Improvements — {r.improvements.current?.scorePct != null ? `current score ${r.improvements.current.scorePct}%, ` : r.improvements.scorePct != null ? `score ${r.improvements.scorePct}%, ` : ""}{r.improvements.completed} completed in the period, {pl(r.improvements.credits, "credit")}
      </H>
      {r.improvements.current?.scorePct != null && (
        <div className="rounded-xl bg-secondary/40 px-3 py-2 mb-3 text-sm">
          <span className="font-semibold">Current score: {r.improvements.current.scorePct}%</span>
          <span className="text-muted-foreground"> — last 30 days ({fmtShort(r.improvements.current.from)} – {fmtShort(r.improvements.current.to)}), the same figure as the improvements leaderboard: {r.improvements.current.credits} credits ÷ {r.improvements.current.shifts ?? "—"} shifts{r.improvements.current.teamAveragePct != null ? `; team average ${r.improvements.current.teamAveragePct}%` : ""}.</span>
        </div>
      )}
      {r.improvements.scorePct != null && (
        <p className="text-sm text-muted-foreground mb-3">
          Over the whole period: 
{r.improvements.scorePct}% ({r.improvements.credits} credits ÷ {r.improvements.daysWorked} days worked). The aim is 100% — one improvement every shift.{r.improvements.teamScorePct != null ? ` The team's is ${r.improvements.teamScorePct}% over the same period.` : ""}
        </p>
      )}
      <div className="flex items-end gap-2 h-32 mb-1" aria-label="Improvements by month">
        {r.improvements.monthly.map(m => (
          <div key={m.month} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0">
            <span className="text-xs tabular-nums font-semibold">{m.completed || ""}</span>
            <div className="w-full rounded-t-md bg-primary/80" style={{ height: `${(m.completed / max) * 80}%`, minHeight: m.completed ? 4 : 1 }} />
          </div>
        ))}
      </div>
      <div className="flex gap-2 mb-4">
        {r.improvements.monthly.map(m => (
          <div key={m.month} className="flex-1 text-center min-w-0">
            <p className="text-xs text-muted-foreground">{fmtMonth(m.month)}</p>
            {r.improvements.shiftsKnown && <p className="text-[11px] text-muted-foreground tabular-nums">{m.scorePct != null ? `${m.scorePct}%` : "—"}</p>}
          </div>
        ))}
      </div>
      {r.improvements.shiftsKnown && <p className="text-xs text-muted-foreground mb-3">The % under each month is the improvement score: credits ÷ days worked that month.</p>}
      {r.improvements.list.length === 0 ? <Empty>No improvements completed in this period.</Empty> : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {r.improvements.list.map(i => (
            <li key={i.id} className="px-3 py-2 flex items-center gap-3 text-sm">
              <span className="text-muted-foreground tabular-nums w-24 shrink-0">{fmtShort(i.date)}</span>
              <span className="flex-1 min-w-0">{i.title}</span>
              <span className="text-xs text-muted-foreground shrink-0">{pl(i.credits, "credit")}</span>
            </li>
          ))}
        </ul>
      )}
      {r.improvements.teamAverage != null && <Note>Team average: {r.improvements.teamAverage} completed per person who worked in the same period.</Note>}
    </div>
  );
}

function TrainingDetail({ r, editing }: { r: PerformanceReport; editing?: ReportEditing }) {
  return (
    <div className="space-y-4">
      <H>Training</H>
      {r.training.stations.length === 0 ? <Empty>No stations on the rota for them in this period, and no SOPs reviewed.</Empty> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {r.training.stations.map(s => (
            <div key={s.station} className="rounded-xl border border-border p-3">
              <p className="font-semibold flex items-center justify-between gap-2">
                <span>{stationName(s.station)}{!s.worksThere && <span className="ml-2 text-xs font-normal text-muted-foreground">not on their rota this period</span>}</span>
                <span className={cn("tabular-nums text-sm", s.trained === s.sopCount ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>{s.trained}/{s.sopCount} trained</span>
              </p>
              {(() => {
                const list = editing?.original.training.stations.find(o => o.station === s.station)?.missing ?? s.missing;
                return list.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {list.map(m => (
                    <li key={m.sopId} className={cn("flex items-center gap-2", leftClass(isLeft(editing, itemKey.sop(s.station, m.sopId))))}>
                      <ItemTick editing={editing} k={itemKey.sop(s.station, m.sopId)} />
                      <span className={cn("text-xs font-semibold rounded-full px-2 py-0.5 shrink-0", m.status === "untrained" ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200" : "bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200")}>
                        {m.status === "untrained" ? "Not trained" : "Refresher"}
                      </span>
                      <span>{m.title}</span>
                    </li>
                  ))}
                </ul>
                );
              })()}
            </div>
          ))}
        </div>
      )}
      {r.training.matrices.length > 0 && (
        <div>
          <p className="font-semibold mb-2">Training matrices</p>
          <ul className="space-y-2">
            {r.training.matrices.map(m => (
              <li key={m.matrixId} className="rounded-xl border border-border p-3 text-sm">
                <p className="font-semibold flex justify-between"><span>{m.name}</span><span className="tabular-nums">{m.trained}/{m.items}</span></p>
                {m.missing.length > 0 && <p className="text-muted-foreground mt-1">Still to do: {m.missing.join(", ")}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {editing && <Note>Untick an SOP that shows as not trained when they are — it then counts as trained in the report.</Note>}
      <Note>Station SOPs come from the stations Planday put them on in this period. "Refresher" means the SOP changed since they last confirmed it.</Note>
    </div>
  );
}

function LeanDetail({ r, editing }: { r: PerformanceReport; editing?: ReportEditing }) {
  const missedList = editing ? editing.original.lean.missed : r.lean.missed;
  const weeks = [...r.lean.completed.map(w => ({ ...w, done: true })), ...missedList.map(w => ({ ...w, quiz: null as string | null, done: false }))]
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  return (
    <div>
      <H>Lean Made Simple — {r.lean.weeksCompleted} of {r.lean.weeksAssigned} weeks completed</H>
      {weeks.length === 0 ? <Empty>No weekly lessons were set for them in this period.</Empty> : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {weeks.map(w => (
            <li key={w.weekStart} className={cn("px-3 py-2 flex items-center gap-3 text-sm", !w.done && leftClass(isLeft(editing, itemKey.leanWeek(w.weekStart))))}>
              {!w.done ? <ItemTick editing={editing} k={itemKey.leanWeek(w.weekStart)} /> : editing ? <span className="w-4 shrink-0" /> : null}
              <span className="text-muted-foreground tabular-nums w-28 shrink-0">w/c {fmtShort(w.weekStart)}</span>
              <span className="flex-1 min-w-0">{w.title ?? "Weekly lesson"}</span>
              <span className={cn("text-xs font-semibold rounded-full px-2 py-0.5 shrink-0", w.done ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200" : "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200")}>
                {w.done ? `Done${w.quiz ? ` · quiz ${w.quiz}` : ""}` : "Missed"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {r.lean.selfPaced > 0 && <Note>Plus {pl(r.lean.selfPaced, "module")} done self-paced in this period.</Note>}
    </div>
  );
}

function RateBlock({ label, s }: { label: string; s: RateStat }) {
  const maxRate = Math.max(1, ...s.perDay.map(d => d.rate ?? 0), s.standard ?? 0);
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="font-semibold">{label} — <span className="tabular-nums">{s.overall ?? "—"}</span> <span className="text-sm font-normal text-muted-foreground">{s.unit}</span></p>
      <dl className="grid grid-cols-3 gap-2 mt-2 text-center">
        {[
          ["Typical day", s.median], ["Usual low", s.min], ["Usual high", s.max],
          ["Standard", s.standard], ["Team", s.teamOverall], ["Days", s.days],
        ].map(([k, v]) => (
          <div key={String(k)} className="rounded-lg bg-secondary/40 py-1.5">
            <dt className="text-[11px] text-muted-foreground">{k}</dt>
            <dd className="font-semibold tabular-nums">{v ?? "—"}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 space-y-1 max-h-56 overflow-y-auto pr-1">
        {[...s.perDay].reverse().map(d => (
          <div key={d.date} className="flex items-center gap-2 text-xs">
            <span className="w-16 shrink-0 text-muted-foreground tabular-nums">{fmtShort(d.date)}</span>
            <div className="flex-1 h-3 rounded bg-secondary/60 overflow-hidden relative">
              {d.rate != null && <div className={cn("h-full", s.standard != null && d.rate < s.standard * 0.9 ? "bg-amber-500" : "bg-primary")} style={{ width: `${(d.rate / maxRate) * 100}%` }} />}
              {s.standard != null && <div className="absolute top-0 bottom-0 w-px bg-foreground/50" style={{ left: `${(s.standard / maxRate) * 100}%` }} title={`Standard ${s.standard}`} />}
            </div>
            <span className="w-12 text-right tabular-nums">{d.rate ?? "short"}</span>
          </div>
        ))}
      </div>
      <Note>{s.how}</Note>
    </div>
  );
}

function SpeedDetail({ r }: { r: PerformanceReport }) {
  const blocks = ([["building", "Building"], ["wrapping", "Wrapping"], ["packing", "Packing"]] as const).filter(([k]) => r.speed[k]);
  return (
    <div>
      <H>Station speed</H>
      {blocks.length === 0 ? <Empty>Nothing recorded against them at building, wrapping or packing in this period.</Empty> : (
        <div className="grid gap-3 lg:grid-cols-3">
          {blocks.map(([k, label]) => <RateBlock key={k} label={label} s={r.speed[k]!} />)}
        </div>
      )}
      <Note>Only work done signed in as them counts. Days under half an hour of active time show as "short" and don't set a rate. The usual low and high leave out the most unusual tenth of days at each end.</Note>
    </div>
  );
}

function ChecklistsDetail({ r, editing }: { r: PerformanceReport; editing?: ReportEditing }) {
  const c = r.checklists;
  if (!c?.known) return <div><H>Checklists</H><Empty>No days rostered on a station with a checklist in this period (or they aren't linked to Planday), so there's nothing to check against.</Empty></div>;
  return (
    <div>
      <H>Checklists — {pl(c.missed, "item")} left unticked</H>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center mb-4">
        {[["Station days worked", c.stationDays], ["Left unticked", c.missed], ["Ticked by them", c.ticked], ["Marked can't-do, with a reason", c.cantDo]].map(([k, v]) => (
          <div key={String(k)} className="rounded-xl bg-secondary/40 py-2">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="text-xl font-bold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {c.byStation.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {c.byStation.map(b => (
            <span key={b.station} className={cn("rounded-full px-3 py-1 text-sm", b.missed > 0 ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200" : "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200")}>
              {stationName(b.station)}: {b.missed} unticked over {pl(b.days, "day")}
            </span>
          ))}
        </div>
      )}
      {(editing?.original.checklists?.missedList ?? c.missedList).length === 0 ? <Empty>Every checklist item was ticked or marked can't-do on the days they were on the station.</Empty> : (
        <ul className="divide-y divide-border rounded-xl border border-border max-h-80 overflow-y-auto">
          {(editing?.original.checklists?.missedList ?? c.missedList).map((m, i) => (
            <li key={`${m.date}-${m.station}-${i}`} className={cn("px-3 py-2 text-sm flex items-center gap-3", leftClass(isLeft(editing, itemKey.checklist(m))))}>
              <ItemTick editing={editing} k={itemKey.checklist(m)} />
              <span className="text-muted-foreground tabular-nums w-20 shrink-0">{fmtShort(m.date)}</span>
              <span className="w-24 shrink-0 text-muted-foreground">{stationName(m.station)}</span>
              <span className="flex-1">{m.title} <span className="text-xs text-muted-foreground">({m.category})</span></span>
            </li>
          ))}
        </ul>
      )}
      <Note>
        An item left blank counts against everyone rostered on that station that day — the rule is to tick it, or mark it "can't do" with a reason. Marking can't-do with a reason is the right thing to do and never counts against them.
      </Note>
    </div>
  );
}

function AttendanceDetail({ r, editing }: { r: PerformanceReport; editing?: ReportEditing }) {
  const a = r.attendance;
  const o = editing?.original.attendance ?? a;
  if (!a.known) return <div><H>Attendance</H><Empty>They aren't linked to Planday, so there's no attendance record to show.</Empty></div>;
  return (
    <div>
      <H>Attendance (from Planday)</H>
      <dl className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center mb-4">
        {[["Attendance", a.attendancePct != null ? `${a.attendancePct}%` : "—"], ["Shifts worked", a.shiftsWorked], ["Sickness absences", a.sickInstances], ["Sick days", a.sickDays], ["Lates", a.lates]].map(([k, v]) => (
          <div key={String(k)} className="rounded-xl bg-secondary/40 py-2">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="text-xl font-bold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-3 sm:grid-cols-2 text-sm">
        <div>
          <p className="font-semibold mb-1">Sickness</p>
          {o.sickSpells.length === 0 ? <Empty>No sickness recorded in Planday this period.</Empty> : (
            <ul className="space-y-1">{o.sickSpells.map(s => (
              <li key={s.start} className={cn("flex items-center gap-2", leftClass(isLeft(editing, itemKey.sick(s.start))))}>
                <ItemTick editing={editing} k={itemKey.sick(s.start)} />
                <span>{fmtShort(s.start)}{s.end !== s.start ? ` – ${fmtShort(s.end)}` : ""} · {pl(s.days, "day")}</span>
              </li>
            ))}</ul>
          )}
        </div>
        <div>
          <p className="font-semibold mb-1">Lates</p>
          {o.lateDates.length === 0 ? <Empty>No lates recorded in Planday this period.</Empty>
            : o.lateDetails && o.lateDetails.length > 0 ? (
              <ul className="space-y-1">
                {o.lateDetails.map(l => (
                  <li key={l.date} className={cn("flex flex-wrap items-center gap-x-2", leftClass(isLeft(editing, itemKey.late(l.date))))}>
                    <ItemTick editing={editing} k={itemKey.late(l.date)} />
                    <span className="tabular-nums w-16">{fmtShort(l.date)}</span>
                    {l.minutesLate != null
                      ? <span className="font-semibold">{l.minutesLate === 0 ? "on time by the clock" : `${l.minutesLate} min late`}</span>
                      : <span className="text-muted-foreground">minutes not known</span>}
                    {l.clockedIn && l.rostered && <span className="text-xs text-muted-foreground">clocked in {l.clockedIn}, due {l.rostered}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="space-y-1">{o.lateDates.map(d => (
                <li key={d} className={cn("flex items-center gap-2", leftClass(isLeft(editing, itemKey.late(d))))}>
                  <ItemTick editing={editing} k={itemKey.late(d)} /><span>{fmtShort(d)}</span>
                </li>
              ))}</ul>
            )}
        </div>
      </div>
      <Note>Attendance % = shifts worked ÷ (shifts worked + absence shifts). Holiday doesn't count against it. {a.otherAbsence > 0 && `${pl(a.otherAbsence, "other absence day")} (not sickness) recorded.`}</Note>
    </div>
  );
}

function RecordsDetail({ r, audience, editing }: { r: PerformanceReport; audience: "manager" | "employee"; editing?: ReportEditing }) {
  const rec = editing?.original.records ?? r.records;
  const list = (items: typeof rec.praise, none: string) => items.length === 0 ? <Empty>{none}</Empty> : (
    <ul className="divide-y divide-border rounded-xl border border-border">
      {items.map(i => (
        <li key={i.entryId} className={cn("px-3 py-2 text-sm flex items-center gap-3", leftClass(isLeft(editing, itemKey.record(i.entryId))))}>
          <ItemTick editing={editing} k={itemKey.record(i.entryId)} />
          <span className="text-muted-foreground tabular-nums w-24 shrink-0">{fmtShort(i.date)}</span>
          <span className="flex-1">{i.title}{i.detail && <span className="text-muted-foreground"> · {i.detail}</span>}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="space-y-4">
      <H>On the record</H>
      <div><p className="font-semibold mb-1">Disciplinary</p>{list(rec.disciplinary, "Nothing recorded in the system for this period.")}</div>
      <div><p className="font-semibold mb-1">Attendance and timekeeping conversations</p>{list(rec.attendanceOrTimekeeping, "Nothing recorded in the system for this period.")}</div>
      <div><p className="font-semibold mb-1">Praise and recognition</p>{list(rec.praise, "Nothing recorded in the system for this period.")}</div>
      {audience === "manager" && <p className="text-sm">Return-to-work forms in this period: <span className="font-semibold">{rec.returnToWorkForms}</span></p>}
      <Note>This shows only what's been recorded in the system. Conversations that weren't written up won't appear here, so a blank section doesn't mean nothing happened.</Note>
    </div>
  );
}

function ContributionsDetail({ r }: { r: PerformanceReport }) {
  const c = r.contributions;
  const t = c.todos;
  return (
    <div>
      <H>Contributions</H>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-center mb-3">
        {[["Factory problems reported", c.factoryReports], ["App issues reported", c.appReports], ["SOPs written", c.sopsWritten]].map(([k, v]) => (
          <div key={String(k)} className="rounded-xl bg-secondary/40 py-2">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="text-xl font-bold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm">
        To-dos given to them: <span className="font-semibold">{t.assigned}</span> · done {t.done} ({t.onTime} on time, {t.late} late) · {t.open} still open
      </p>
      <Note>Reporting problems counts in their favour — it's how things get fixed. To-dos they set themselves and weekly Lean lessons aren't counted here.</Note>
    </div>
  );
}

const KIND_TONE: Record<string, string> = {
  objective: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
  agreement: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200",
  feedback: "bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200",
  note: "bg-secondary text-foreground",
};

/** One note, in full. The tick and the prep button only while going through
 *  the live report; the privacy badge only for the manager. */
function NoteItem({ n, audience, editing, showEntry }: { n: ReportNote; audience: "manager" | "employee"; editing?: ReportEditing; showEntry?: boolean }) {
  const left = isLeft(editing, itemKey.note(n.id));
  return (
    <li className={cn("px-3 py-2.5 text-sm flex items-start gap-3", leftClass(left))}>
      {editing && (n.shared ? <span className="pt-0.5"><ItemTick editing={editing} k={itemKey.note(n.id)} /></span> : <Lock className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" aria-label="Private" />)}
      <div className="flex-1 min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("text-xs font-semibold rounded-full px-2 py-0.5", KIND_TONE[n.kind] ?? KIND_TONE.note)}>{NOTE_KIND_LABELS[n.kind] ?? "Note"}</span>
          {noteTitle(n) && <span className="font-semibold">{noteTitle(n)}</span>}
          {n.kind === "objective" && (n.done
            ? <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Done</span>
            : n.dueDate ? <span className="text-xs text-muted-foreground">due {fmtShort(n.dueDate)}</span> : null)}
          {audience === "manager" && editing && (
            n.shared ? <span className="text-xs text-muted-foreground">Shared with them</span>
              : <span className="text-xs font-semibold text-muted-foreground">{n.sharedWithHr ? "Private — shared with HR" : "Private — only you"} · not in the saved copy</span>
          )}
        </p>
        <p className="mt-1 whitespace-pre-wrap break-words">{n.body}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {fmtShort(n.date)}{n.author ? ` · ${n.author}` : ""}{showEntry && n.entryTitle ? ` · ${n.entryTitle}` : ""}
        </p>
      </div>
      {editing?.addToPrep && (
        <button type="button" onClick={() => editing.addToPrep!(noteAsText(n))} title="Add to your prep notes"
          className="shrink-0 h-9 px-2.5 rounded-lg border border-border text-xs flex items-center gap-1 hover:bg-secondary">
          <ClipboardPlus className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Prep notes</span>
        </button>
      )}
    </li>
  );
}

/** The notes on their record — inside the report, or as the panel beside the
 *  prep notes on the manager's page (`heading={false}`). */
export function NotesDetail({ r, audience, editing, heading = true }: { r: PerformanceReport; audience: "manager" | "employee"; editing?: ReportEditing; heading?: boolean }) {
  const n = editing?.original.notes ?? r.notes;
  if (!n) return <div><H>Notes on the record</H><Empty>This copy was saved before notes were part of the report.</Empty></div>;
  // Grouped by the meeting or entry they belong to, newest first.
  const groups: Array<{ key: string; title: string; date: string | null; notes: ReportNote[] }> = [];
  for (const note of n.list) {
    const key = note.entryId != null ? `e${note.entryId}` : "loose";
    let g = groups.find(x => x.key === key);
    if (!g) { g = { key, title: note.entryTitle ?? "Notes not on a meeting", date: note.entryDate, notes: [] }; groups.push(g); }
    g.notes.push(note);
  }
  const all = [...n.fromLastReview, ...n.list];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {heading && <H>Notes on the record — {fmtShort(r.period.from)} to {fmtShort(r.period.to)}</H>}
        {editing?.addToPrep && all.length > 0 && (
          <button type="button" onClick={() => editing.addToPrep!(all.map(noteAsText).join("\n\n"))}
            className={cn("h-10 px-3 rounded-lg border-2 border-primary/40 text-sm font-semibold flex items-center gap-1.5 hover:bg-primary/5", heading && "-mt-3")}>
            <ClipboardPlus className="w-4 h-4" /> Add all to my prep notes
          </button>
        )}
      </div>
      {n.lastReview && (
        <div>
          <p className="font-semibold mb-1">From their last review — {n.lastReview.title}, {fmtDay(n.lastReview.date)}</p>
          {n.fromLastReview.length === 0 ? <Empty>No objectives or agreements written up on it{audience === "manager" ? " that you can see" : ""}.</Empty> : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {n.fromLastReview.map(x => <NoteItem key={x.id} n={x} audience={audience} editing={editing} />)}
            </ul>
          )}
        </div>
      )}
      <div className="space-y-3">
        <p className="font-semibold">Written in this period</p>
        {groups.length === 0 ? <Empty>Nothing written on their record in this period{audience === "manager" ? " that you can see" : ""}.</Empty> : groups.map(g => (
          <div key={g.key}>
            <p className="text-sm text-muted-foreground mb-1">{g.title}{g.date ? ` · ${fmtDay(g.date)}` : ""}</p>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {g.notes.map(x => <NoteItem key={x.id} n={x} audience={audience} editing={editing} />)}
            </ul>
          </div>
        ))}
      </div>
      {audience === "manager" && editing && (
        <Note>Private notes — yours, or ones shared with you as HR — show here for you only, with a padlock. They're never in a saved or shared copy: to include one, share it on their record first.</Note>
      )}
    </div>
  );
}

/**
 * The write-up of the meeting a saved report is attached to, read live
 * (Graeme, 24 Nov 2026: what the note taker recorded "all come[s] through
 * to the final report that gets published"). The person only ever gets what
 * has been shared with them.
 */
export interface MeetingWriteUp { entryId: number; title: string; date: string | null; notes: ReportNote[] }

const WRITE_UP_ORDER = ["feedback", "agreement", "objective", "note"];

export function MeetingWriteUpView({ writeUp, audience }: { writeUp: MeetingWriteUp | null | undefined; audience: "manager" | "employee" }) {
  if (!writeUp) return null;
  if (audience === "employee" && writeUp.notes.length === 0) return null;
  const notes = [...writeUp.notes].sort((a, b) => WRITE_UP_ORDER.indexOf(a.kind) - WRITE_UP_ORDER.indexOf(b.kind));
  const privateCount = notes.filter(x => !x.shared).length;
  return (
    <section className="rounded-2xl border-2 border-primary/30 bg-card p-4 sm:p-5 mb-4">
      <h3 className="text-lg font-display font-bold">The review meeting — {writeUp.title}{writeUp.date ? `, ${fmtDay(writeUp.date)}` : ""}</h3>
      {notes.length === 0 ? <Empty>Nothing written up for this meeting yet. Add the meeting notes on their record and they'll show here.</Empty> : (
        <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
          {notes.map(x => (
            <li key={x.id} className="px-3 py-2.5 text-sm">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cn("text-xs font-semibold rounded-full px-2 py-0.5", KIND_TONE[x.kind] ?? KIND_TONE.note)}>{NOTE_KIND_LABELS[x.kind] ?? "Note"}</span>
                {noteTitle(x) && <span className="font-semibold">{noteTitle(x)}</span>}
                {x.kind === "objective" && x.dueDate && <span className="text-xs text-muted-foreground">due {fmtShort(x.dueDate)}</span>}
                {audience === "manager" && !x.shared && <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1"><Lock className="w-3 h-3" /> Private — they don't see this yet</span>}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words">{x.body}</p>
            </li>
          ))}
        </ul>
      )}
      {audience === "manager" && privateCount > 0 && <Note>{pl(privateCount, "part")} of the write-up {privateCount === 1 ? "is" : "are"} still private. Sharing the report lets you share your own write-up with it.</Note>}
    </section>
  );
}

/** "1 Jun 2026 – 24 Nov 2026" */
export function periodLabel(r: PerformanceReport): string {
  return `${fmtDay(r.period.from)} – ${fmtDay(r.period.to)}`;
}
