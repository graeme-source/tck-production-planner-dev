/**
 * Finance → Payroll (Graeme, 2026-10-26): the monthly Planday payroll report
 * — 25th of last month to the 24th of this one — with each person's hours,
 * pay and estimated take-home, sick days (with their normal working week),
 * joiners (with their payroll paperwork) and leavers. Download it as a PDF or
 * email it with the starter forms attached. API: /api/payroll.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Loader2, Mail, Thermometer, UserMinus, UserPlus, Users } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Period { from: string; to: string; label: string }
interface Person { plandayEmployeeId: number; name: string; hours: number; shifts: number; hourlyRate: number | null; salaried: boolean; grossPay: number; netEstimate: number | null; contractHoursPerWeek: number | null; contractDaysPerWeek: number | null }
interface Sick { plandayEmployeeId: number; name: string; date: string; hours: number | null; contractHoursPerWeek: number | null; contractDaysPerWeek: number | null }
interface Change { plandayEmployeeId: number; name: string; date: string; documents?: string[] }
interface Report {
  period: Period; periods: Period[]; current: Period;
  people: Person[]; sick: Sick[]; joiners: Change[]; leavers: Change[];
  totals: { hours: number; grossPay: number; netEstimate: number };
  assumptions: string[]; warnings: string[];
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
  const r = q.data;
  const demoAllowed = r?.demoAllowed ?? import.meta.env.DEV;
  const send = useMutation({
    mutationFn: () => api<{ ok: true; attached: string[] }>("/email", { method: "POST", body: JSON.stringify({
      from: r!.period.from, to: r!.period.to,
      emails: emails.split(/[,;\s]+/).map(e => e.trim()).filter(Boolean), note: note.trim() || null, includeStarterForms: withForms,
    }) }),
    onSuccess: res => { toast({ title: "Payroll report sent", description: `${res.attached.length} file${res.attached.length === 1 ? "" : "s"} attached` }); void qc.invalidateQueries({ queryKey: ["payroll-sends"] }); },
    onError: (e: Error) => { toast({ title: "Didn't send", description: e.message, variant: "destructive" }); void qc.invalidateQueries({ queryKey: ["payroll-sends"] }); },
  });
  const emailList = emails.split(/[,;\s]+/).filter(Boolean);
  const emailsOk = emailList.length > 0 && emailList.every(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));

  return (
    <div className="space-y-5">
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
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Big label="People paid" value={String(r.people.length)} sub={r.period.label} />
            <Big label="Hours" value={hrs(r.totals.hours)} />
            <Big label="Gross pay" value={gbp(r.totals.grossPay)} />
            <Big label="Take-home (estimate)" value={gbp(r.totals.netEstimate)} sub="see assumptions below" />
          </div>

          {r.warnings.length > 0 && (
            <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm space-y-1">
              {r.warnings.map((w, i) => <p key={i}>{w}</p>)}
            </div>
          )}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px] items-start">
            <div className="space-y-4">
              <Section icon={<Users className="w-5 h-5" />} title={`Hours and pay · ${r.people.length}`}>
                <div className="grid gap-2 md:grid-cols-2">
                  {r.people.map(p => (
                    <div key={p.plandayEmployeeId} className="rounded-2xl border-2 border-border p-3">
                      <p className="font-bold text-lg break-words">{p.name}</p>
                      <p className="text-sm text-muted-foreground">{p.shifts} shift{p.shifts === 1 ? "" : "s"} · {hrs(p.hours)}{p.hourlyRate != null ? ` · ${gbp(p.hourlyRate)}/h` : p.salaried ? " · salaried" : ""}</p>
                      <div className="flex gap-4 mt-1">
                        <p><span className="text-xs text-muted-foreground block">Gross</span><span className="font-bold tabular-nums">{gbp(p.grossPay)}</span></p>
                        <p><span className="text-xs text-muted-foreground block">Take-home (est.)</span><span className="font-bold tabular-nums text-primary">{gbp(p.netEstimate)}</span></p>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>

              <Section icon={<Thermometer className="w-5 h-5" />} title={`Sick days · ${r.sick.length}`}>
                {r.sick.length === 0 ? <p className="text-sm text-muted-foreground">No sick days this period.</p> : (
                  <div className="space-y-1.5">
                    {r.sick.map((s, i) => (
                      <div key={i} className="rounded-xl bg-secondary/50 px-3 py-2 flex flex-wrap gap-x-3">
                        <span className="font-semibold">{s.name}</span>
                        <span>{day(s.date)}{s.hours != null ? ` · ${hrs(s.hours)}` : ""}</span>
                        <span className="text-muted-foreground">{normalWeek(s.contractDaysPerWeek, s.contractHoursPerWeek)}</span>
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
                  {r.leavers.length === 0 ? <p className="text-sm text-muted-foreground">No leavers.</p> : r.leavers.map((l, i) => (
                    <p key={i} className="rounded-xl bg-secondary/50 px-3 py-2"><span className="font-semibold">{l.name}</span> · last day {day(l.date)}</p>
                  ))}
                </Section>
              </div>

              {r.assumptions.length > 0 && (
                <div className="text-xs text-muted-foreground space-y-0.5 max-w-prose">
                  <p className="font-semibold">Take-home is an estimate:</p>
                  {r.assumptions.map((a, i) => <p key={i}>{a}</p>)}
                </div>
              )}
            </div>

            <aside className="rounded-3xl border-2 border-border bg-card p-4 space-y-3 xl:sticky xl:top-4">
              <p className="text-lg font-bold">Send or download</p>
              <a href={`${BASE}/api/payroll/pdf?from=${r.period.from}&to=${r.period.to}${r.demo ? "&demo=1" : ""}`}
                className="h-12 rounded-xl border-2 border-border font-semibold inline-flex items-center justify-center gap-2 w-full hover:bg-secondary">
                <Download className="w-5 h-5" /> Download PDF
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
        </>
      )}
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
