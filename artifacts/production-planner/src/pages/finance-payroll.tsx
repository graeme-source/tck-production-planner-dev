/**
 * Finance → Payroll (Graeme, 2026-10-26): the monthly Planday payroll report
 * — 25th of last month to the 24th of this one — with each person's hours
 * and gross pay, sick days (with their normal working week),
 * joiners (with their payroll paperwork) and leavers — added by hand, since
 * Planday only marks a leaver after their last payroll. Download it as a PDF or
 * email it with the starter forms attached. API: /api/payroll.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Download, FileText, Loader2, Mail, Plus, Thermometer, UserMinus, UserPlus, Users, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PayrollAccountantEmail } from "@/components/payroll-accountant-email";
import { PayrollMonthEnd, PayrollMonthEndHistory } from "@/components/payroll-month-end";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Period { from: string; to: string; label: string }
interface Person {
  plandayEmployeeId: number; name: string; hours: number; shifts: number; hourlyRate: number | null; salaried: boolean; grossPay: number;
  productionHours: number; productionPay: number; officeHours: number; officePay: number;
  office: Array<{ work: string; hours: number; pay: number }>;
  holidayHours: number; holidayPay: number | null;
  contractHoursPerWeek: number | null; contractDaysPerWeek: number | null;
}
interface Sick { plandayEmployeeId: number; name: string; date: string; hours: number | null; ssp: number | null; contractHoursPerWeek: number | null; contractDaysPerWeek: number | null }
interface Ssp { plandayEmployeeId: number; name: string; sickDays: number; total: number; byHandDays: number; awe: number | null; weeklySsp: number | null; qualifyingDaysPerWeek: number | null; notes: string[] }
interface Change { plandayEmployeeId: number; name: string; date: string; documents?: string[] }
interface Leaver { id: number; name: string; date: string; note: string | null; addedBy: string | null }
interface Report {
  period: Period; periods: Period[]; current: Period;
  people: Person[]; sick: Sick[]; ssp: Ssp[]; joiners: Change[]; leavers: Leaver[];
  totals: { hours: number; grossPay: number; productionHours: number; productionPay: number; officeHours: number; officePay: number; holidayHours: number; holidayPay: number; sspEstimate: number };
  warnings: string[];
  demo?: boolean; demoAllowed?: boolean;
}
interface Send { id: number; from: string; to: string; sentTo: string[]; attachments: string[]; sentBy: string | null; ok: boolean; error: string | null; sentAt: string }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}/api/payroll${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
  return body as T;
}

const gbp = (n: number | null) => n == null ? "—" : `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hrs = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString("en-GB")} h`;
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const normalWeek = (days: number | null, hours: number | null) =>
  days == null && hours == null ? "normal week not set in Planday"
  : `normally ${[days != null ? `${days} day${days === 1 ? "" : "s"}` : null, hours != null ? `${hours} hours` : null].filter(Boolean).join(" / ")} a week`;

export function PayrollPanel() {
  const qc = useQueryClient();
  const [period, setPeriod] = useState<Period | null>(null);
  // Made-up people, test server only (the server refuses it on live).
  const [demo, setDemo] = useState(false);
  const params = new URLSearchParams(period ? { from: period.from, to: period.to } : {});
  if (demo) params.set("demo", "1");
  const qs = params.size ? `?${params}` : "";
  const q = useQuery({ queryKey: ["payroll", period?.from ?? "default", demo], queryFn: () => api<Report>(qs) });
  const sends = useQuery({ queryKey: ["payroll-sends"], queryFn: () => api<{ sends: Send[] }>("/sends") });
  const [emails, setEmails] = useState("");
  const [note, setNote] = useState("");
  const [withForms, setWithForms] = useState(true);
  // Month-end history appendix — off by default so the monthly report stays short.
  const [withHistory, setWithHistory] = useState(false);
  const r = q.data;
  const demoAllowed = r?.demoAllowed ?? import.meta.env.DEV;
  const send = useMutation({
    mutationFn: () => api<{ ok: true; attached: string[] }>("/email", { method: "POST", body: JSON.stringify({
      from: r!.period.from, to: r!.period.to,
      emails: emails.split(/[,;\s]+/).map(e => e.trim()).filter(Boolean), note: note.trim() || null, includeStarterForms: withForms, includeHistory: withHistory,
    }) }),
    onSuccess: res => { toast({ title: "Payroll report sent", description: `${res.attached.length} file${res.attached.length === 1 ? "" : "s"} attached` }); void qc.invalidateQueries({ queryKey: ["payroll-sends"] }); },
    onError: (e: Error) => { toast({ title: "Didn't send", description: e.message, variant: "destructive" }); void qc.invalidateQueries({ queryKey: ["payroll-sends"] }); },
  });
  const emailList = emails.split(/[,;\s]+/).filter(Boolean);
  const emailsOk = emailList.length > 0 && emailList.every(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));

  return (
    <div className="space-y-5">
      <PayrollAccountantEmail />
      {/* Pay periods: 25th → 24th. */}
      <div className="flex flex-wrap gap-2">
        {(r?.periods ?? []).map(p => (
          <button key={p.from} type="button" onClick={() => setPeriod(p)}
            className={cn("h-11 px-4 rounded-xl border-2 font-semibold", r?.period.from === p.from ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary")}>
            {p.label}
          </button>
        ))}
        {r?.current && (
          <button type="button" onClick={() => setPeriod(r.current)}
            className={cn("h-11 px-4 rounded-xl border-2 border-dashed font-semibold", r.period.from === r.current.from ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary")}>
            {r.current.label} (so far)
          </button>
        )}
      </div>

      {q.isLoading && <div className="flex items-center gap-2 text-muted-foreground py-10 justify-center"><Loader2 className="w-5 h-5 animate-spin" /> Reading Planday…</div>}
      {q.error && <p className="text-red-600">{(q.error as Error).message}</p>}
      {demoAllowed && (
        <button type="button" onClick={() => setDemo(d => !d)}
          className="h-11 px-4 rounded-xl border-2 border-dashed border-amber-500 text-amber-700 dark:text-amber-400 font-semibold">
          {demo ? "Back to real data" : "Show sample data (test server only)"}
        </button>
      )}

      {r && (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Big label="People paid" value={String(r.people.length)} sub={r.period.label} />
            <Big label="Hours" value={hrs(r.totals.hours)} sub={r.totals.holidayHours > 0 ? `incl. ${hrs(r.totals.holidayHours)} holiday` : undefined} />
            <Big label="Gross pay" value={gbp(r.totals.grossPay)} sub="production + holiday + office" />
            <Big label="Office work" value={gbp(r.totals.officePay)} sub={`${hrs(r.totals.officeHours)} · below the line`} />
          </div>

          {r.warnings.length > 0 && (
            <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm space-y-1">
              {r.warnings.map((w, i) => <p key={i}>{w}</p>)}
            </div>
          )}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px] items-start">
            <div className="space-y-4">
              <Section icon={<Users className="w-5 h-5" />} title={`Production and holiday · ${r.people.filter(p => p.productionHours > 0 || p.holidayHours > 0).length}`}>
                <div className="grid gap-2 md:grid-cols-2">
                  {r.people.filter(p => p.productionHours > 0 || p.holidayHours > 0).map(p => (
                    <div key={p.plandayEmployeeId} className="rounded-2xl border-2 border-border p-3">
                      <p className="font-bold text-lg break-words">{p.name}</p>
                      <p className="text-sm text-muted-foreground">{p.shifts} shift{p.shifts === 1 ? "" : "s"} · {hrs(p.productionHours)}{p.hourlyRate != null ? ` · ${gbp(p.hourlyRate)}/h` : p.salaried ? " · salaried" : ""}</p>
                      <div className="flex flex-wrap gap-x-5 gap-y-1 mt-1">
                        <p><span className="text-xs text-muted-foreground block">Production</span><span className="font-bold tabular-nums">{gbp(p.productionPay)}</span></p>
                        {p.holidayHours > 0 && (
                          <p>
                            <span className="text-xs text-muted-foreground block">Holiday · {hrs(p.holidayHours)}</span>
                            {p.holidayPay != null
                              ? <span className="font-bold tabular-nums">{gbp(p.holidayPay)}</span>
                              : <span className="font-semibold text-amber-700 dark:text-amber-300">work out by hand</span>}
                          </p>
                        )}
                        {p.officeHours > 0 && (
                          <p><span className="text-xs text-muted-foreground block">+ office (below)</span><span className="font-semibold tabular-nums text-muted-foreground">{gbp(p.officePay)}</span></p>
                        )}
                        <p><span className="text-xs text-muted-foreground block">Total gross</span><span className="font-bold tabular-nums">{gbp(p.grossPay)}</span></p>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-sm font-semibold mt-3 tabular-nums">
                  Production {gbp(r.totals.productionPay)} + holiday {gbp(r.totals.holidayPay)} = {gbp(r.totals.productionPay + r.totals.holidayPay)}
                </p>
              </Section>

              {/* Below the line (Graeme, 2026-10-27): shifts in a Planday
                  section other than Production — media, maintenance,
                  planning, meetings. */}
              <Section icon={<Briefcase className="w-5 h-5" />} title={`Below the line — office work · ${hrs(r.totals.officeHours)}`}>
                {r.totals.officeHours === 0 ? <p className="text-sm text-muted-foreground">No office work this period — shifts count as office work when their Planday position is in a section other than Production.</p> : (
                  <div className="space-y-1.5">
                    {r.people.flatMap(p => p.office.map(o => ({ name: p.name, id: p.plandayEmployeeId, ...o }))).map(o => (
                      <div key={`${o.id}-${o.work}`} className="rounded-xl bg-secondary/50 px-3 py-2 flex flex-wrap items-baseline gap-x-3">
                        <span className="font-semibold">{o.name}</span>
                        <span>{o.work}</span>
                        <span className="text-muted-foreground tabular-nums">{hrs(o.hours)}</span>
                        <span className="ml-auto font-bold tabular-nums">{gbp(o.pay)}</span>
                      </div>
                    ))}
                    <p className="text-sm font-semibold pt-1 tabular-nums">Office total {gbp(r.totals.officePay)}</p>
                  </div>
                )}
              </Section>

              {!r.demo && <PayrollMonthEnd from={r.period.from} to={r.period.to} />}

              <Section icon={<Thermometer className="w-5 h-5" />} title={`Sick days · ${r.sick.length}`}>
                {r.sick.length === 0 ? <p className="text-sm text-muted-foreground">No sick days this period.</p> : (
                  <div className="space-y-1.5">
                    {r.sick.map((s, i) => (
                      <div key={i} className="rounded-xl bg-secondary/50 px-3 py-2 flex flex-wrap gap-x-3">
                        <span className="font-semibold">{s.name}</span>
                        <span>{day(s.date)}{s.hours != null ? ` · ${hrs(s.hours)}` : ""}</span>
                        <span className="text-muted-foreground">{normalWeek(s.contractDaysPerWeek, s.contractHoursPerWeek)}</span>
                        <span className="ml-auto tabular-nums">{s.ssp != null ? <>SSP est. <b>{gbp(s.ssp)}</b></> : <span className="text-amber-700 dark:text-amber-300 font-semibold">SSP by hand</span>}</span>
                      </div>
                    ))}
                  </div>
                )}
                {r.ssp.length > 0 && (
                  <div className="mt-3 rounded-2xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-2">
                    <p className="font-bold">Statutory Sick Pay — estimate for the accountant to check · {gbp(r.totals.sspEstimate)}</p>
                    <p className="text-xs text-muted-foreground max-w-prose">
                      Rules from 6 April 2026: paid from the first day off, the lower of £123.25 a week or 80% of average weekly earnings
                      (pay earned in the 8 weeks before the sickness began), shared over their usual working days. Linked spells and the
                      28-week limit are counted. Not added to gross pay.
                    </p>
                    {r.ssp.map(x => (
                      <div key={x.plandayEmployeeId} className="rounded-xl bg-background px-3 py-2">
                        <p className="flex flex-wrap gap-x-3"><span className="font-semibold">{x.name}</span><span>{x.sickDays} day{x.sickDays === 1 ? "" : "s"}</span><span className="ml-auto font-bold tabular-nums">{x.byHandDays >= x.sickDays ? <span className="text-amber-700 dark:text-amber-300">by hand</span> : <>{gbp(x.total)}{x.byHandDays > 0 ? ` + ${x.byHandDays} by hand` : ""}</>}</span></p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {[x.awe != null ? `avg weekly earnings ${gbp(x.awe)}` : null, x.weeklySsp != null ? `weekly SSP ${gbp(x.weeklySsp)}` : null, x.qualifyingDaysPerWeek != null ? `${x.qualifyingDaysPerWeek} working day${x.qualifyingDaysPerWeek === 1 ? "" : "s"} a week` : null].filter(Boolean).join(" · ")}
                        </p>
                        {x.notes.map((n, i) => <p key={i} className="text-xs font-semibold text-amber-700 dark:text-amber-300">{n}</p>)}
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <div className="grid gap-4 md:grid-cols-2">
                <Section icon={<UserPlus className="w-5 h-5" />} title={`Joiners · ${r.joiners.length}`}>
                  {r.joiners.length === 0 ? <p className="text-sm text-muted-foreground">No joiners.</p> : r.joiners.map((j, i) => (
                    <div key={i} className="rounded-xl bg-secondary/50 px-3 py-2 space-y-1">
                      <p><span className="font-semibold">{j.name}</span> · started {day(j.date)}</p>
                      {(j.documents ?? []).length > 0
                        ? <p className="flex flex-wrap gap-1">{j.documents!.map(d => <span key={d} className="text-xs rounded-full bg-card border px-2 py-0.5 inline-flex items-center gap-1"><FileText className="w-3 h-3" />{d}</span>)}</p>
                        : <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">No signed starter forms yet</p>}
                    </div>
                  ))}
                </Section>
                <Section icon={<UserMinus className="w-5 h-5" />} title={`Leavers · ${r.leavers.length}`}>
                  <LeaversPanel from={r.period.from} to={r.period.to} leavers={r.leavers} names={r.people.map(p => p.name)} />
                </Section>
              </div>

            </div>

            <aside className="rounded-3xl border-2 border-border bg-card p-4 space-y-3 xl:sticky xl:top-4">
              <p className="text-lg font-bold">Send or download</p>
              <a href={`${BASE}/api/payroll/pdf?from=${r.period.from}&to=${r.period.to}${r.demo ? "&demo=1" : ""}${withHistory ? "&history=1" : ""}`}
                className="h-12 rounded-xl border-2 border-border font-semibold inline-flex items-center justify-center gap-2 w-full hover:bg-secondary">
                <Download className="w-5 h-5" /> Download PDF{withHistory ? " + history" : ""}
              </a>
              <label className="block space-y-1 text-sm">
                <span className="font-semibold">Email to</span>
                <input value={emails} onChange={e => setEmails(e.target.value)} placeholder="accountant@example.com, …" className="w-full h-11 px-3 rounded-xl border-2 border-border bg-background" />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-semibold">Note (optional)</span>
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={1000} className="w-full px-3 py-2 rounded-xl border-2 border-border bg-background" />
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={withForms} onChange={e => setWithForms(e.target.checked)} className="mt-1" />
                <span>Attach joiners' payroll paperwork (HMRC starter checklist, payroll details, P45). Health forms are never sent.</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={withHistory} onChange={e => setWithHistory(e.target.checked)} className="mt-1" />
                <span>Add the month-end history since 31 Mar 2025 as an appendix (and a CSV). This month's month-end adjustments are always in the report.</span>
              </label>
              <button type="button" disabled={!emailsOk || send.isPending || !!r.demo} onClick={() => send.mutate()}
                className="h-12 w-full rounded-xl bg-primary text-primary-foreground font-bold inline-flex items-center justify-center gap-2 disabled:opacity-40">
                {send.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Mail className="w-5 h-5" />} Send report
              </button>
              {(sends.data?.sends ?? []).length > 0 && (
                <div className="pt-2 border-t border-border space-y-1 text-xs">
                  <p className="font-semibold text-sm">Sent</p>
                  {sends.data!.sends.slice(0, 6).map(s => (
                    <p key={s.id} className={s.ok ? "text-muted-foreground" : "text-red-600"}>
                      {new Date(s.sentAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {s.from} → {s.to} · to {s.sentTo.join(", ")}{s.sentBy ? ` · by ${s.sentBy}` : ""}{s.ok ? "" : ` · failed: ${s.error}`}
                    </p>
                  ))}
                </div>
              )}
            </aside>
          </div>

          {!r.demo && <PayrollMonthEndHistory />}
        </>
      )}
    </div>
  );
}

/** Leavers are added by hand: Planday only marks someone as gone after
 *  their last payroll has run, which is after this report. */
function LeaversPanel({ from, to, leavers, names }: { from: string; to: string; leavers: Leaver[]; names: string[] }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [lastDay, setLastDay] = useState("");
  const [note, setNote] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["payroll"] });
  const add = useMutation({
    mutationFn: () => api<{ ok: true }>("/leavers", { method: "POST", body: JSON.stringify({ from, name: name.trim(), lastDay, note: note.trim() || null }) }),
    onSuccess: () => { toast({ title: "Leaver added", description: `${name.trim()} · saved` }); setName(""); setLastDay(""); setNote(""); void refresh(); },
    onError: (e: Error) => toast({ title: "Didn't save", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api<{ ok: true }>(`/leavers/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast({ title: "Leaver removed" }); void refresh(); },
    onError: (e: Error) => toast({ title: "Didn't remove", description: e.message, variant: "destructive" }),
  });
  const ok = name.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(lastDay);
  return (
    <div className="space-y-3">
      {leavers.length === 0 ? <p className="text-sm text-muted-foreground">No leavers added for this pay period.</p> : leavers.map(l => (
        <div key={l.id} className="rounded-xl bg-secondary/50 px-3 py-2 flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <p><span className="font-semibold break-words">{l.name}</span> · last day {day(l.date)}</p>
            {l.note && <p className="text-sm text-muted-foreground break-words">{l.note}</p>}
            {l.addedBy && <p className="text-xs text-muted-foreground">added by {l.addedBy}</p>}
          </div>
          <button type="button" aria-label={`Remove ${l.name}`} disabled={remove.isPending} onClick={() => remove.mutate(l.id)}
            className="h-9 w-9 shrink-0 rounded-lg border-2 border-border inline-flex items-center justify-center hover:bg-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
      <div className="rounded-2xl border-2 border-dashed border-border p-3 space-y-2">
        <p className="text-sm font-semibold">Add a leaver</p>
        <input list="payroll-leaver-names" value={name} onChange={e => setName(e.target.value)} placeholder="Name"
          className="w-full h-11 px-3 rounded-xl border-2 border-border bg-background" />
        <datalist id="payroll-leaver-names">{names.map(n => <option key={n} value={n} />)}</datalist>
        <label className="block text-sm space-y-1">
          <span className="text-muted-foreground">Last day</span>
          <input type="date" value={lastDay} onChange={e => setLastDay(e.target.value)}
            className="w-full h-11 px-3 rounded-xl border-2 border-border bg-background" />
        </label>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note for payroll (optional) — e.g. holiday owed"
          className="w-full h-11 px-3 rounded-xl border-2 border-border bg-background" />
        <button type="button" disabled={!ok || add.isPending} onClick={() => add.mutate()}
          className="h-11 w-full rounded-xl bg-primary text-primary-foreground font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50">
          {add.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add leaver
        </button>
      </div>
    </div>
  );
}

function Big({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-3xl border-2 border-border bg-card p-5">
      <p className="text-sm font-semibold text-muted-foreground">{label}</p>
      <p className="text-3xl font-display font-bold tabular-nums">{value}</p>
      {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border-2 border-border bg-card p-4 space-y-3">
      <h3 className="text-lg font-bold flex items-center gap-2">{icon}{title}</h3>
      {children}
    </section>
  );
}
