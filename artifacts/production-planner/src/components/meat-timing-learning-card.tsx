/**
 * "Prep-oven timings" card on the Recipes page (Graeme, 2026-10-27) — the
 * managers' window on the self-correcting meat times:
 *   - each raw meat: cook + processing + grace now, what the floor says
 *     (typical and slow-end lead, the runs it's based on), what the next
 *     learning run would change, its trust score and the daily-review counts
 *     (ready on time / builders waited / too early; model vs human vs capacity);
 *   - every automatic or hand change, with Revert;
 *   - the week's off-time put-ins and the reasons given;
 *   - learning on/off per meat, Review now / Learn now.
 * Cook time is shown but never changed here — it's the food-safety value.
 *
 * Server: GET/POST/PUT /api/meat-timing (routes/meat-timing.ts).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Beef, CheckCircle2, Loader2, RotateCcw, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { formatClock, type MeatLearning, type TrustSignal } from "@workspace/production-schedule";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const KEY = ["meat-timing"];

interface ReviewStats {
  reviewed: number; followed: number; notFollowed: number; perfect: number; waited: number; tooEarly: number; cutFine: number;
  model: number; human: number; capacity: number; avgWait: number | null; avgSat: number | null;
}
interface MeatRow {
  ingredientId: number;
  name: string;
  cookMinutes: number | null;
  processMinutes: number | null;
  graceMinutes: number | null;
  autoLearn: boolean;
  configuredLeadMinutes: number | null;
  learning: MeatLearning;
  trust: TrustSignal;
  habit: "early" | "late" | null;
  review: ReviewStats | null;
}
interface Adjustment {
  id: number; ingredientName: string; field: "process" | "grace"; oldValue: number | null; newValue: number;
  source: "auto" | "manual" | "revert"; reason: string; runsUsed: number | null; actorName: string | null;
  revertedAt: string | null; revertedByName: string | null; createdAt: string;
}
interface Weekly {
  putIns: number; onTime: number; offTime: number;
  byReason: Array<{ code: string; count: number }>;
  items: Array<{ id: number; planDate: string; recipeName: string; ingredientName: string; suggestedAtMinutes: number | null; putInMinutes: number; deviationMinutes: number | null; reasonCode: string | null; reasonNote: string | null; outcome: string | null }>;
}
interface Data {
  meats: MeatRow[];
  adjustments: Adjustment[];
  settings: {
    maxHoldMinutes: number; learningEnabled: boolean; lastAutoRun: string | null; reasonMinutes: number;
    mixReadyBeforeMinutes: number; hotReadyBeforeMinutes: number;
  };
  weekly: Weekly;
  reasons: Array<{ code: string; label: string }>;
}

async function send(path: string, method: string, body: unknown = {}) {
  const res = await fetch(`${BASE}/api/meat-timing${path}`, {
    method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`);
  return json;
}

const OUTCOME_DOT: Record<string, string> = {
  perfect: "bg-emerald-500", cut_fine: "bg-lime-400", builders_waited: "bg-rose-500", too_early: "bg-amber-400", unknown: "bg-muted",
};

function MeatCard({ m, onToggle, busy }: { m: MeatRow; onToggle: (on: boolean) => void; busy: boolean }) {
  const l = m.learning;
  const r = m.review;
  return (
    <div className="rounded-xl border-2 border-border p-4 space-y-3 bg-background">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-lg font-bold flex items-center gap-2"><Beef className="w-5 h-5 text-rose-500" />{m.name}</p>
          <p className="text-sm text-muted-foreground tabular-nums">
            Cook {m.cookMinutes ?? "?"} + processing {m.processMinutes ?? "?"} + grace {m.graceMinutes ?? 0} min
            {" "}(the schedule uses the bigger of grace and the hot-meat target)
          </p>
        </div>
        {m.trust.trusted ? (
          <span className="inline-flex items-center gap-1 text-sm font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 whitespace-nowrap">
            <CheckCircle2 className="w-4 h-4" /> Trusted
          </span>
        ) : m.trust.score != null ? (
          <span className="text-sm font-semibold px-2.5 py-1 rounded-full bg-secondary whitespace-nowrap">{Math.round(m.trust.score * 100)}% right</span>
        ) : null}
      </div>

      {l.status === "learned" && l.lead ? (
        <p className="text-sm">
          The floor (last {l.runsUsed} runs): in the oven → first tin mixed typically <b>{Math.round(l.lead.median)} min</b>,
          {" "}slow days <b>{Math.round(l.lead.slow)} min</b> (range {Math.round(l.lead.min)}–{Math.round(l.lead.max)}).
          {l.learned && <> Points to processing <b>{l.learned.processMinutes}</b>, grace <b>{l.learned.graceMinutes}</b>.</>}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {l.status === "no_cook_time" ? "No cook time set — learning waits for one (it never guesses a cook time)." : `Not enough clean runs yet (${l.runsUsed} usable of ${l.runsSeen}) — the set times stand.`}
        </p>
      )}
      {l.changes.length > 0 && (
        <ul className="text-sm space-y-1">
          {l.changes.map(c => (
            <li key={c.field} className="rounded-lg bg-primary/5 px-3 py-2">
              Next run: {c.field} {c.from ?? "unset"} → <b>{c.to} min</b>. <span className="text-muted-foreground">{c.reason}</span>
            </li>
          ))}
        </ul>
      )}

      {r && r.reviewed > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1" aria-label="Recent days, newest first">
            {m.trust.recent.map((o, i) => <span key={i} className={cn("w-4 h-4 rounded-full", OUTCOME_DOT[o])} title={o.replace("_", " ")} />)}
          </div>
          <p className="text-sm text-muted-foreground">
            {r.reviewed} reviewed: {r.perfect} on target, {r.cutFine} cut fine, {r.waited} builders waited{r.avgWait ? ` (~${r.avgWait} min)` : ""}, {r.tooEarly} too early.
            {" "}Time followed {r.followed}, not followed {r.notFollowed}. Misses: {r.model} the times', {r.human} people's, {r.capacity} capacity.
            {m.habit && <> The team habitually puts this in <b>{m.habit}</b> — the learning follows that.</>}
          </p>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" className="w-5 h-5" checked={m.autoLearn} disabled={busy} onChange={e => onToggle(e.target.checked)} />
        Learn this automatically
      </label>
    </div>
  );
}

export function MeatTimingLearningCard() {
  const { state } = useAuth();
  const canManage = state.status === "authenticated" && (state.user.role === "admin" || state.user.role === "manager");
  const isAdmin = state.status === "authenticated" && state.user.role === "admin";
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [hold, setHold] = useState<string>("");
  const [reasonMin, setReasonMin] = useState<string>("");
  const [mixReady, setMixReady] = useState<string>("");
  const [hotReady, setHotReady] = useState<string>("");

  const { data, isLoading, isError, error } = useQuery<Data>({
    queryKey: KEY,
    enabled: canManage && open,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/meat-timing`, { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't load prep-oven timings (${res.status})`);
      return res.json();
    },
  });

  const done = (title: string) => () => {
    toast({ title });
    qc.invalidateQueries({ queryKey: KEY });
    qc.invalidateQueries({ queryKey: ["plan-schedule"] });
  };
  const fail = (err: unknown) => toast({ title: "Didn't save", description: err instanceof Error ? err.message : String(err), variant: "destructive" });

  const run = useMutation({ mutationFn: () => send("/run", "POST"), onSuccess: (r: { applied: unknown[] }) => done(`Learned: ${r.applied.length} change(s) applied`)(), onError: fail });
  const review = useMutation({ mutationFn: () => send("/review-now", "POST"), onSuccess: (r: { reviewed: number }) => done(`Reviewed ${r.reviewed} put-in(s)`)(), onError: fail });
  const revert = useMutation({ mutationFn: (id: number) => send(`/adjustments/${id}/revert`, "POST"), onSuccess: done("Reverted — learning paused for that meat"), onError: fail });
  const toggle = useMutation({
    mutationFn: (b: { id: number; on: boolean }) => send(`/ingredients/${b.id}`, "PUT", { autoLearn: b.on }),
    onSuccess: done("Saved"), onError: fail,
  });
  const saveSettings = useMutation({
    mutationFn: (b: Record<string, unknown>) => send("/settings", "PUT", b),
    onSuccess: done("Settings saved"), onError: fail,
  });

  if (!canManage) return null;
  const reasonLabel = (code: string) => data?.reasons.find(r => r.code === code)?.label ?? (code === "not_answered" ? "Not answered yet" : code);

  return (
    <section className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <button className="w-full flex items-center justify-between gap-3 text-left" onClick={() => setOpen(o => !o)}>
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" /> Prep-oven timings — self-correcting</h2>
          <p className="text-sm text-muted-foreground">How long each meat really takes, what the system changed and why, and how often the times were right.</p>
        </div>
        {open ? <ChevronUp className="w-6 h-6" /> : <ChevronDown className="w-6 h-6" />}
      </button>

      {open && (isLoading ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>
      ) : isError || !data ? (
        <p className="text-sm text-rose-600">{error instanceof Error ? error.message : "Couldn't load"}</p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">
              Learning {data.settings.learningEnabled ? "runs daily after production" : "is switched off"}
              {data.settings.lastAutoRun ? ` · last ${data.settings.lastAutoRun}` : ""}
            </span>
            <button onClick={() => review.mutate()} disabled={review.isPending} className="min-h-[44px] px-4 rounded-xl border border-border font-medium disabled:opacity-50">
              {review.isPending ? "Reviewing…" : "Review now"}
            </button>
            <button onClick={() => run.mutate()} disabled={run.isPending} className="min-h-[44px] px-4 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50">
              {run.isPending ? "Learning…" : "Learn now"}
            </button>
          </div>

          <div className="grid gap-3 grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3">
            {data.meats.map(m => (
              <MeatCard key={m.ingredientId} m={m} busy={toggle.isPending} onToggle={on => toggle.mutate({ id: m.ingredientId, on })} />
            ))}
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-bold">This week's off-time put-ins</h3>
            <p className="text-sm text-muted-foreground">
              {data.weekly.putIns} put-ins, {data.weekly.onTime} within {data.settings.reasonMinutes} min of the suggested time, {data.weekly.offTime} off.
              {data.weekly.byReason.length > 0 && " Reasons: " + data.weekly.byReason.map(b => `${reasonLabel(b.code)} ${b.count}`).join(" · ")}
            </p>
            {data.weekly.items.length > 0 && (
              <ul className="grid gap-2 grid-cols-1 lg:grid-cols-2">
                {data.weekly.items.map(it => (
                  <li key={it.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                    <b>{it.ingredientName}</b> for {it.recipeName} · {it.planDate}: in {formatClock(it.putInMinutes)} vs {it.suggestedAtMinutes != null ? formatClock(it.suggestedAtMinutes) : "—"}
                    {" "}({(it.deviationMinutes ?? 0) > 0 ? "+" : ""}{it.deviationMinutes} min) — {reasonLabel(it.reasonCode ?? "not_answered")}{it.reasonNote ? `: ${it.reasonNote}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-bold">Changes</h3>
            {data.adjustments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changes yet.</p>
            ) : (
              <ul className="space-y-2">
                {data.adjustments.map(a => (
                  <li key={a.id} className={cn("rounded-lg border border-border px-3 py-2 text-sm flex items-start justify-between gap-3", a.revertedAt && "opacity-60")}>
                    <div>
                      <b>{a.ingredientName}</b> {a.field} {a.oldValue ?? "unset"} → {a.newValue} min
                      <span className="text-muted-foreground"> · {a.source === "auto" ? "learned" : a.source} · {a.actorName ?? ""} · {new Date(a.createdAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</span>
                      <p className="text-muted-foreground">{a.reason}</p>
                      {a.revertedAt && <p className="text-xs">Reverted by {a.revertedByName}</p>}
                    </div>
                    {a.source !== "revert" && !a.revertedAt && (
                      <button onClick={() => revert.mutate(a.id)} disabled={revert.isPending} className="min-h-[40px] px-3 rounded-lg border border-border inline-flex items-center gap-1.5 whitespace-nowrap">
                        <RotateCcw className="w-4 h-4" /> Revert
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {isAdmin && (
            <div className="flex flex-wrap items-end gap-4 border-t border-border pt-4">
              <label className="text-sm">
                <span className="block font-medium">Cooked meat out at most (min, oven-out → last batch)</span>
                <input type="number" min={30} max={240} className="mt-1 w-28 rounded-lg border border-border bg-background px-3 py-2" placeholder={String(data.settings.maxHoldMinutes)} value={hold} onChange={e => setHold(e.target.value)} />
              </label>
              <label className="text-sm">
                <span className="block font-medium">Ask why when put in more than (min) off</span>
                <input type="number" min={3} max={60} className="mt-1 w-28 rounded-lg border border-border bg-background px-3 py-2" placeholder={String(data.settings.reasonMinutes)} value={reasonMin} onChange={e => setReasonMin(e.target.value)} />
              </label>
              <label className="text-sm">
                <span className="block font-medium">Every mix ready before needed (min)</span>
                <input type="number" min={0} max={60} className="mt-1 w-28 rounded-lg border border-border bg-background px-3 py-2" placeholder={String(data.settings.mixReadyBeforeMinutes)} value={mixReady} onChange={e => setMixReady(e.target.value)} />
              </label>
              <label className="text-sm">
                <span className="block font-medium">Hot meat ready before needed (min)</span>
                <input type="number" min={0} max={60} className="mt-1 w-28 rounded-lg border border-border bg-background px-3 py-2" placeholder={String(data.settings.hotReadyBeforeMinutes)} value={hotReady} onChange={e => setHotReady(e.target.value)} />
              </label>
              <label className="text-sm flex items-center gap-2 pb-2">
                <input type="checkbox" className="w-5 h-5" checked={data.settings.learningEnabled} onChange={e => saveSettings.mutate({ learningEnabled: e.target.checked })} />
                Daily automatic learning
              </label>
              <button
                disabled={saveSettings.isPending || (!hold && !reasonMin && !mixReady && !hotReady)}
                onClick={() => saveSettings.mutate({
                  ...(hold ? { maxHoldMinutes: Number(hold) } : {}),
                  ...(reasonMin ? { reasonMinutes: Number(reasonMin) } : {}),
                  ...(mixReady ? { mixReadyBeforeMinutes: Number(mixReady) } : {}),
                  ...(hotReady ? { hotReadyBeforeMinutes: Number(hotReady) } : {}),
                }, { onSuccess: () => { setHold(""); setReasonMin(""); setMixReady(""); setHotReady(""); } })}
                className="min-h-[44px] px-4 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50"
              >
                {saveSettings.isPending ? "Saving…" : "Save settings"}
              </button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
