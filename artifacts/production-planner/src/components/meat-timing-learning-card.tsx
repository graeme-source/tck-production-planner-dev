/**
 * "Prep-oven timings" card on the Recipes page (Graeme, 2026-10-27) — the
 * managers' window on the self-correcting meat times:
 *   - each hot raw meat: cook (set, never changed) + learned processing +
 *     learned buffer; the processing spread and runs behind it; what the next
 *     learning run would change; trust and recent outcomes; minutes SAT and
 *     builders' WAIT (the two numbers being minimised); model vs human vs
 *     capacity; the 4-hour rule as checked on reviewed days;
 *   - every automatic or hand change, with Revert;
 *   - the week's off-time put-ins and the reasons given;
 *   - the 4-hour rule as applied (total, chill, bake and where each came
 *     from), and the admin settings.
 *
 * Server: GET/POST/PUT /api/meat-timing (routes/meat-timing.ts).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Beef, CheckCircle2, Loader2, RotateCcw, Sparkles, ChevronDown, ChevronUp, ShieldCheck, AlertTriangle } from "lucide-react";
import { formatClock, type MeatLearning, type TrustSignal } from "@workspace/production-schedule";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const KEY = ["meat-timing"];

interface ReviewStats {
  reviewed: number; followed: number; notFollowed: number; perfect: number; waited: number; tooEarly: number;
  model: number; human: number; capacity: number; avgWait: number | null; avgSat: number | null;
  totalSat: number; totalWait: number; safetyChecked: number; safetyMeasured: number; safetyBreaches: number; worstSafetyMinutes: number | null;
}
interface MeatRow {
  ingredientId: number;
  name: string;
  cookMinutes: number | null;
  processMinutes: number | null;
  bufferMinutes: number | null;
  autoLearn: boolean;
  configuredLeadMinutes: number | null;
  learning: MeatLearning;
  trust: TrustSignal;
  habit: "early" | "late" | null;
  review: ReviewStats | null;
}
interface Adjustment {
  id: number; ingredientName: string; field: "process" | "buffer"; oldValue: number | null; newValue: number;
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
    learningEnabled: boolean; lastAutoRun: string | null; reasonMinutes: number;
    safeTotalMinutes: number; chillMinutes: number; bakeMinutesOverride: number | null; waitWeight: number; bufferMaxMinutes: number;
  };
  safety: {
    totalMinutes: number; chillMinutes: number; bakeMinutes: number; bakeSource: "setting" | "learned" | "default"; maxSpanMinutes: number;
    chillRecorded: { median: number | null; samples: number };
    bakeLearned: { minutes: number | null; samples: number };
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
  perfect: "bg-emerald-500", builders_waited: "bg-rose-500", too_early: "bg-amber-400", unknown: "bg-muted",
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
            In the oven <b className="text-foreground">{m.configuredLeadMinutes ?? "?"} min</b> before the builders need it:
            {" "}cook {m.cookMinutes ?? "?"} (set) + processing {m.processMinutes ?? "?"} + buffer {m.bufferMinutes ?? 5}
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

      {l.status === "learned" && l.processing ? (
        <p className="text-sm">
          Out of the oven → first tin mixed (last {l.runsUsed} runs): <b>{Math.round(l.processing.estimate)} min</b>
          {" "}(typical {Math.round(l.processing.median)}, slow days {Math.round(l.processing.slow)}, range {Math.round(l.processing.min)}–{Math.round(l.processing.max)}).
          {l.learned && <> Learned: processing <b>{l.learned.processMinutes}</b>, buffer <b>{l.learned.bufferMinutes}</b>{l.needErrorRuns ? ` (from ${l.needErrorRuns} days of builder timing)` : ""}.</>}
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
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-secondary/50 px-3 py-2">
              <p className="text-2xl font-extrabold tabular-nums">{r.avgSat ?? "—"}<span className="text-sm font-medium"> min</span></p>
              <p className="text-xs text-muted-foreground">average sat ready before needed</p>
            </div>
            <div className={cn("rounded-lg px-3 py-2", r.waited > 0 ? "bg-rose-50 dark:bg-rose-900/20" : "bg-secondary/50")}>
              <p className="text-2xl font-extrabold tabular-nums">{r.waited}<span className="text-sm font-medium"> days</span></p>
              <p className="text-xs text-muted-foreground">builders waited{r.avgWait ? ` (~${r.avgWait} min)` : ""}</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {r.reviewed} reviewed: {r.perfect} right, {r.waited} builders waited, {r.tooEarly} too early.
            {" "}Time followed {r.followed}, not followed {r.notFollowed}. Misses: {r.model} the times', {r.human} people's, {r.capacity} capacity.
            {m.habit && <> The team habitually puts this in <b>{m.habit}</b> — the learning follows that.</>}
          </p>
          {r.safetyChecked > 0 && (
            <p className={cn("text-sm flex items-center gap-1.5", r.safetyBreaches ? "text-rose-700 dark:text-rose-300 font-semibold" : "text-muted-foreground")}>
              {r.safetyBreaches ? <AlertTriangle className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4 text-emerald-600" />}
              4-hour rule: {r.safetyChecked} days checked ({r.safetyMeasured} with a measured chill), {r.safetyBreaches} over{r.worstSafetyMinutes != null ? ` · longest ${Math.floor(r.worstSafetyMinutes / 60)}h ${r.worstSafetyMinutes % 60}m` : ""}.
            </p>
          )}
        </div>
      )}

      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" className="w-5 h-5" checked={m.autoLearn} disabled={busy} onChange={e => onToggle(e.target.checked)} />
        Learn this automatically
      </label>
    </div>
  );
}

function NumberSetting({ label, placeholder, value, onChange, min, max }: { label: string; placeholder: string; value: string; onChange: (v: string) => void; min: number; max: number }) {
  return (
    <label className="text-sm">
      <span className="block font-medium">{label}</span>
      <input type="number" min={min} max={max} className="mt-1 w-28 rounded-lg border border-border bg-background px-3 py-2" placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
    </label>
  );
}

export function MeatTimingLearningCard() {
  const { state } = useAuth();
  const canManage = state.status === "authenticated" && (state.user.role === "admin" || state.user.role === "manager");
  const isAdmin = state.status === "authenticated" && state.user.role === "admin";
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const set = (k: string) => (v: string) => setDraft(d => ({ ...d, [k]: v }));

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
  const numbers: Array<[string, string]> = [
    ["safeTotalMinutes", "safeTotalMinutes"], ["chillMinutes", "chillMinutes"], ["bakeMinutes", "bakeMinutes"],
    ["reasonMinutes", "reasonMinutes"], ["waitWeight", "waitWeight"], ["bufferMaxMinutes", "bufferMaxMinutes"],
  ];
  const dirty = numbers.some(([k]) => (draft[k] ?? "") !== "");

  return (
    <section className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <button className="w-full flex items-center justify-between gap-3 text-left" onClick={() => setOpen(o => !o)}>
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" /> Prep-oven timings — self-correcting</h2>
          <p className="text-sm text-muted-foreground">How long each meat really takes after the oven, the buffer that keeps the builders from waiting, what changed and why, and the 4-hour rule.</p>
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

          <div className="rounded-xl border-2 border-emerald-300 dark:border-emerald-800 p-4 space-y-1">
            <p className="font-bold flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-600" /> The 4-hour rule</p>
            <p className="text-sm">
              Out of the prep oven → that recipe's last batch built, baked and chilled to 8 °C within <b>{data.safety.totalMinutes} min</b>.
              {" "}Chill {data.safety.chillMinutes} min, bake {data.safety.bakeMinutes} min ({data.safety.bakeSource === "learned" ? `learned from ${data.safety.bakeLearned.samples} recipes at the ovens` : data.safety.bakeSource === "setting" ? "set by hand" : "default"})
              {" "}→ cooked meat may be out at most <b>{data.safety.maxSpanMinutes} min</b> before the last batch is built. Longer builds are planned in waves.
            </p>
            <p className="text-xs text-muted-foreground">
              Recorded "mark as chilled" taps say {data.safety.chillRecorded.median ?? "—"} min (median of {data.safety.chillRecorded.samples}) — taps are often late, so planning uses the setting;
              {" "}the daily review uses a registered probe's reading first, then a plausible tap.
            </p>
          </div>

          <div className="grid gap-3 grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3">
            {data.meats.map(m => (
              <MeatCard key={m.ingredientId} m={m} busy={toggle.isPending} onToggle={on => toggle.mutate({ id: m.ingredientId, on })} />
            ))}
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-bold">This week's off-time put-ins</h3>
            <p className="text-sm text-muted-foreground">
              {data.weekly.putIns} put-ins, {data.weekly.onTime} on the suggested time (± {data.settings.reasonMinutes} min plus loading time), {data.weekly.offTime} off.
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
              <NumberSetting label="4-hour rule total (min)" min={60} max={240} placeholder={String(data.settings.safeTotalMinutes)} value={draft.safeTotalMinutes ?? ""} onChange={set("safeTotalMinutes")} />
              <NumberSetting label="Chill to 8 °C (min)" min={30} max={240} placeholder={String(data.settings.chillMinutes)} value={draft.chillMinutes ?? ""} onChange={set("chillMinutes")} />
              <NumberSetting label="Bake (min, blank = learn)" min={0} max={120} placeholder={data.settings.bakeMinutesOverride != null ? String(data.settings.bakeMinutesOverride) : `learned ${data.safety.bakeMinutes}`} value={draft.bakeMinutes ?? ""} onChange={set("bakeMinutes")} />
              <NumberSetting label="Ask why beyond (min)" min={3} max={60} placeholder={String(data.settings.reasonMinutes)} value={draft.reasonMinutes ?? ""} onChange={set("reasonMinutes")} />
              <NumberSetting label="A wait minute counts as (× sitting)" min={1} max={20} placeholder={String(data.settings.waitWeight)} value={draft.waitWeight ?? ""} onChange={set("waitWeight")} />
              <NumberSetting label="Buffer cap (min)" min={2} max={60} placeholder={String(data.settings.bufferMaxMinutes)} value={draft.bufferMaxMinutes ?? ""} onChange={set("bufferMaxMinutes")} />
              <label className="text-sm flex items-center gap-2 pb-2">
                <input type="checkbox" className="w-5 h-5" checked={data.settings.learningEnabled} onChange={e => saveSettings.mutate({ learningEnabled: e.target.checked })} />
                Daily automatic learning
              </label>
              <button
                disabled={saveSettings.isPending || !dirty}
                onClick={() => saveSettings.mutate(
                  Object.fromEntries(numbers.filter(([k]) => (draft[k] ?? "") !== "").map(([k, field]) => [field, Number(draft[k])])),
                  { onSuccess: () => setDraft({}) },
                )}
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
