/**
 * "What's taught when" — the ONE place to set the lean lesson of the week
 * (Graeme, 19 Nov 2026). Pick a ready week and the Monday it starts; the
 * weeks after carry on through the plan, teaching only ready (locked) weeks.
 * Shows the next eight weeks, and when the plan would run out within two
 * weeks it offers — or has already added — the next backlog subject with
 * its lessons written, waiting to be approved.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { AlertTriangle, CalendarClock, Check, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  return body as T;
}

type ScheduleWeek = {
  weekStart: string;
  principle: { id: number; title: string; partLabel: string | null; ready: boolean } | null;
  source: "set" | "follows";
  wrapped: boolean;
};
type Schedule = {
  thisMonday: string;
  weeks: ScheduleWeek[];
  runsOutOn: string | null;
  waiting: { id: number; title: string; partLabel: string | null; lessons: number } | null;
  suggestion: { id: number; title: string } | null;
  readyWeeks: Array<{ id: number; title: string; partLabel: string | null; weekPosition: number }>;
};

export const LEAN_SCHEDULE_KEY = ["lean-schedule"] as const;
const label = (p: { title: string; partLabel: string | null }) => (p.partLabel ? `${p.title} — ${p.partLabel}` : p.title);
const wc = (d: string) => format(parseISO(d), "d MMM");

export function LeanScheduleCard({ onReview }: { onReview: (weekId: number) => void }) {
  const qc = useQueryClient();
  const q = useQuery<Schedule>({ queryKey: LEAN_SCHEDULE_KEY, queryFn: () => api<Schedule>("/lean-curriculum/schedule") });
  const s = q.data;
  const [principleId, setPrincipleId] = useState<number | "">("");
  const [weekStart, setWeekStart] = useState<string>("");
  // Default the picker to next Monday and what's planned for it.
  useEffect(() => {
    if (!s) return;
    if (!weekStart) setWeekStart(s.weeks[1]?.weekStart ?? s.thisMonday);
    if (principleId === "") {
      const next = s.weeks[1]?.principle;
      if (next && s.readyWeeks.some(r => r.id === next.id)) setPrincipleId(next.id);
    }
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = (data?: Schedule) => {
    if (data) qc.setQueryData(LEAN_SCHEDULE_KEY, data);
    qc.invalidateQueries({ queryKey: LEAN_SCHEDULE_KEY });
    qc.invalidateQueries({ queryKey: ["lean-curriculum"] });
    qc.invalidateQueries({ queryKey: ["lean-week-plan"] });
  };
  const start = useMutation({
    mutationFn: () => api<Schedule>("/lean-curriculum/schedule/start", { method: "PUT", body: JSON.stringify({ weekStart, principleId }) }),
    onSuccess: (data) => { refresh(data); toast({ title: "Schedule set", description: "The weeks after it follow on through the plan." }); },
    onError: (e: Error) => toast({ title: "Couldn't set it", description: e.message, variant: "destructive" }),
  });
  const fill = useMutation({
    mutationFn: () => api<{ added: string | null; reason: string; schedule: Schedule }>("/lean-curriculum/schedule/fill", { method: "POST", body: "{}" }),
    onSuccess: (r) => {
      refresh(r.schedule);
      toast(r.added
        ? { title: `${r.added} added`, description: "Its lessons are written — read them, then lock the week in." }
        : { title: "Nothing added", description: r.reason });
    },
    onError: (e: Error) => toast({ title: "Couldn't add the next week", description: e.message, variant: "destructive" }),
  });

  if (q.isLoading) return <div className="rounded-3xl border bg-card p-5 flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading the schedule…</div>;
  if (q.isError || !s) return <div className="rounded-3xl border bg-card p-5 text-destructive">{(q.error as Error)?.message ?? "Couldn't load the schedule"}</div>;

  const weekName = (i: number, d: string) => (i === 0 ? `This week · ${wc(d)}` : i === 1 ? `Next week · ${wc(d)}` : `w/c ${wc(d)}`);

  return (
    <section className="rounded-3xl border-2 border-primary/30 bg-card shadow-sm p-5 space-y-4">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0"><CalendarClock className="w-5 h-5" /></span>
        <div className="min-w-0">
          <h2 className="text-xl font-display font-extrabold">What's taught when</h2>
          <p className="text-sm text-muted-foreground">The one place to set the lesson of the week. Weeks after the one you set follow on through the plan — ready weeks only.</p>
        </div>
      </div>

      {s.runsOutOn && (
        s.waiting ? (
          <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-4 flex flex-wrap items-center gap-3">
            <Sparkles className="w-5 h-5 text-amber-700 shrink-0" />
            <p className="flex-1 min-w-[14rem] text-sm">
              <span className="font-bold">{label(s.waiting)}</span> is next{s.waiting.lessons > 0 ? ", written and waiting for you" : ", but its lessons aren't written yet"}.
              Lock it in before <span className="font-semibold">w/c {wc(s.runsOutOn)}</span> or the plan starts again from the top.
            </p>
            <button type="button" onClick={() => onReview(s.waiting!.id)}
              className="min-h-[48px] px-4 rounded-xl bg-foreground text-background font-bold">Review and approve</button>
          </div>
        ) : (
          <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-4 flex flex-wrap items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" />
            <p className="flex-1 min-w-[14rem] text-sm">
              Nothing new is ready from <span className="font-semibold">w/c {wc(s.runsOutOn)}</span> — it would start again from the top.
              {s.suggestion && <> Next in the backlog: <span className="font-bold">{s.suggestion.title}</span>.</>}
            </p>
            {s.suggestion && (
              <button type="button" onClick={() => fill.mutate()} disabled={fill.isPending}
                className="min-h-[48px] px-4 rounded-xl bg-primary text-primary-foreground font-bold inline-flex items-center gap-2 disabled:opacity-60">
                {fill.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Writing the week…</> : <><Sparkles className="w-4 h-4" /> Add {s.suggestion.title} and write it</>}
              </button>
            )}
          </div>
        )
      )}

      <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {s.weeks.map((w, i) => (
          <li key={w.weekStart} className={cn("rounded-2xl border p-3 space-y-1", i === 0 ? "border-primary bg-primary/5" : "border-border", w.wrapped && "border-amber-300 bg-amber-50/60 dark:bg-amber-950/20")}>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{weekName(i, w.weekStart)}</div>
            <div className="font-bold leading-tight break-words">{w.principle ? label(w.principle) : "Nothing to teach"}</div>
            <div className="flex flex-wrap gap-1">
              {w.source === "set"
                ? <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-primary/15 text-primary">Set</span>
                : <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-secondary text-muted-foreground">Follows on</span>}
              {w.wrapped && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-amber-200 text-amber-900 inline-flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Starts again</span>}
            </div>
          </li>
        ))}
      </ol>

      <div className="rounded-2xl bg-secondary/40 p-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Start</span>
        <select value={principleId} onChange={e => setPrincipleId(e.target.value ? Number(e.target.value) : "")} aria-label="Week to teach"
          className="h-11 rounded-xl border-2 border-border bg-background px-3 font-semibold min-w-[14rem] max-w-full">
          <option value="">Choose a ready week…</option>
          {s.readyWeeks.map(r => <option key={r.id} value={r.id}>{r.weekPosition} · {label(r)}</option>)}
        </select>
        <span className="text-sm font-semibold">on</span>
        <select value={weekStart} onChange={e => setWeekStart(e.target.value)} aria-label="Starting Monday"
          className="h-11 rounded-xl border-2 border-border bg-background px-3 font-semibold">
          {s.weeks.map((w, i) => <option key={w.weekStart} value={w.weekStart}>{i === 0 ? "This week" : i === 1 ? "Next Monday" : "Monday"} {wc(w.weekStart)}</option>)}
        </select>
        <button type="button" onClick={() => start.mutate()} disabled={principleId === "" || !weekStart || start.isPending}
          className="min-h-[44px] px-4 rounded-xl bg-foreground text-background font-bold inline-flex items-center gap-2 disabled:opacity-50">
          {start.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Set
        </button>
        <span className="text-xs text-muted-foreground basis-full">Weeks before it keep what they have; everything after follows on from it.</span>
      </div>
    </section>
  );
}
