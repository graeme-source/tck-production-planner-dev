/**
 * "Prep oven timings — self-correcting" (Graeme, 2026-10-27) — the managers'
 * window on the self-correcting meat times. Shown in two places:
 *   - the Recipes page, as a fold-away card (MeatTimingLearningCard);
 *   - the Mixing & Cooking station's Station menu, as a pop-up
 *     (MeatTimingReviewDialog) — tucked away, not on the station screen, but
 *     open to everyone who works there (Graeme, 28 Oct 2026: "the people
 *     that are doing the work need access to it"). Only managers and admins
 *     see the controls (put back, on/off, update now, settings).
 *
 * Plain by default (Graeme, 28 Oct 2026: "give me information that is just
 * clear about what has happened and what needs to happen, and what changes
 * you're proposing"). Each meat reads as: when it goes in now → the change
 * suggested (or none) and why → what really happened. The numbers behind it
 * (cook + oven-to-mix + spare, the daily outcomes) sit in a "How it's worked
 * out" fold; meats without enough days yet are one short list. Wording:
 * lib/meat-timing-summary.ts.
 *
 * Server: GET/POST/PUT /api/meat-timing (routes/meat-timing.ts).
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, Beef, CheckCircle2, ChevronDown, ChevronUp, Clock, Loader2, RotateCcw, ShieldCheck, Sparkles, X,
} from "lucide-react";
import { formatClock, type MeatLearning, type TrustSignal } from "@workspace/production-schedule";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { adjustmentFieldLabel, meatTimingSummary } from "@/lib/meat-timing-summary";
import { formatUkDate } from "@workspace/uk-date";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const KEY = ["meat-timing"];

interface ReviewStats {
  reviewed: number; followed: number; notFollowed: number; perfect: number; waited: number; tooEarly: number;
  model: number; human: number; capacity: number; avgWait: number | null; avgSat: number | null;
  totalSat: number; totalWait: number; safetyChecked: number; safetyBreaches: number; worstSafetyMinutes: number | null;
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
  headline: { days: number; runs: number; avgSatMinutes: number | null; builderWaits: number; measuredChillDays: number; measuredOverLimit: number };
  meats: MeatRow[];
  adjustments: Adjustment[];
  settings: {
    learningEnabled: boolean; lastAutoRun: string | null; reasonMinutes: number; waitWeight: number; bufferMaxMinutes: number;
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

const OUTCOME: Record<string, { dot: string; label: string }> = {
  perfect: { dot: "bg-emerald-500", label: "right" },
  builders_waited: { dot: "bg-rose-500", label: "builders waited" },
  too_early: { dot: "bg-amber-400", label: "too early" },
  unknown: { dot: "bg-muted", label: "not known" },
};

function Fold({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="min-h-[40px] inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />} {label}
      </button>
      {open && <div className="pt-1 space-y-2">{children}</div>}
    </div>
  );
}

function MeatCard({ m, learningEnabled, canManage, onToggle, busy }: { m: MeatRow; learningEnabled: boolean; canManage: boolean; onToggle: (on: boolean) => void; busy: boolean }) {
  const s = meatTimingSummary(m, learningEnabled);
  const r = m.review;
  const p = s.proposal;
  return (
    <div className="rounded-xl border-2 border-border p-4 space-y-3 bg-background">
      <div>
        <p className="text-lg font-bold flex items-center gap-2"><Beef className="w-5 h-5 text-rose-500 shrink-0" />{m.name}</p>
        {s.now && <p className="text-base font-semibold flex items-center gap-1.5 mt-1"><Clock className="w-4 h-4 text-muted-foreground shrink-0" />{s.now}</p>}
      </div>

      {p.kind === "change" ? (
        <div className="rounded-lg border-2 border-primary/40 bg-primary/5 px-3 py-2.5 space-y-1">
          <p className="text-xs font-bold uppercase tracking-wide text-primary">Suggested change</p>
          <p className="font-bold flex items-start gap-1.5"><ArrowRight className="w-4 h-4 mt-1 shrink-0 text-primary" />{p.headline}</p>
          <p className="text-sm">{p.why}</p>
          <p className="text-sm text-muted-foreground">{p.when}</p>
        </div>
      ) : p.kind === "none" ? (
        <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 shrink-0" />{p.headline}</p>
      ) : (
        <p className="text-sm text-muted-foreground">{p.headline}</p>
      )}

      {s.happened.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">What happened</p>
          {s.happened.map((h, i) => <p key={i} className="text-sm">{h}</p>)}
        </div>
      )}

      {r && r.safetyBreaches > 0 && (
        <p className="text-sm font-semibold text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Over the 4-hour limit on {r.safetyBreaches} of {r.safetyChecked} measured days
          {r.worstSafetyMinutes != null ? ` (longest ${Math.floor(r.worstSafetyMinutes / 60)}h ${r.worstSafetyMinutes % 60}m)` : ""}.
        </p>
      )}

      <Fold label="How it's worked out">
        {s.breakdown && <p className="text-sm">{s.breakdown}</p>}
        <p className="text-sm text-muted-foreground">
          The cooking time is the one set on the ingredient and is never changed. The other two are learned from when the meat
          came out of the oven and when the first tin was ticked as mixed, and move a few minutes at a time.
        </p>
        {m.trust.recent.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>Recent days, newest first:</span>
            <span className="flex items-center gap-1" aria-hidden>
              {m.trust.recent.map((o, i) => <span key={i} className={cn("w-3.5 h-3.5 rounded-full", OUTCOME[o]?.dot)} title={OUTCOME[o]?.label} />)}
            </span>
            <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" /> right · <span className="inline-block w-2.5 h-2.5 rounded-full bg-rose-500" /> builders waited · <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" /> too early</span>
          </div>
        )}
        {r && r.notFollowed > 0 && (
          <p className="text-sm text-muted-foreground">
            On {r.notFollowed} of {r.reviewed} days it went in at a different time from the one suggested — those days aren't used to learn from.
          </p>
        )}
        {m.habit && <p className="text-sm text-muted-foreground">The team usually puts this in a little {m.habit}, and the timing follows that.</p>}
        {r && r.safetyChecked > 0 && r.safetyBreaches === 0 && (
          <p className="text-sm text-muted-foreground flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-emerald-600" /> Within the 4-hour limit on all {r.safetyChecked} measured days.</p>
        )}
        {canManage && (
          <label className="flex items-center gap-2 text-sm font-medium min-h-[40px]">
            <input type="checkbox" className="w-5 h-5" checked={m.autoLearn} disabled={busy} onChange={e => onToggle(e.target.checked)} />
            Change this meat's time automatically
          </label>
        )}
      </Fold>
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

function useCanManage() {
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : null;
  return { canManage: role === "admin" || role === "manager", isAdmin: role === "admin" };
}

/** Everything under the heading — used by the Recipes card and the station pop-up. */
function MeatTimingReview() {
  const { canManage, isAdmin } = useCanManage();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const set = (k: string) => (v: string) => setDraft(d => ({ ...d, [k]: v }));

  const { data, isLoading, isError, error } = useQuery<Data>({
    queryKey: KEY,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/meat-timing`, { credentials: "include" });
      if (!res.ok) throw new Error(`Couldn't load prep oven timings (${res.status})`);
      return res.json();
    },
  });

  const done = (title: string) => () => {
    toast({ title });
    qc.invalidateQueries({ queryKey: KEY });
    qc.invalidateQueries({ queryKey: ["plan-schedule"] });
  };
  const fail = (err: unknown) => toast({ title: "Didn't save", description: err instanceof Error ? err.message : String(err), variant: "destructive" });

  const run = useMutation({ mutationFn: () => send("/run", "POST"), onSuccess: (r: { applied: unknown[] }) => done(r.applied.length ? `${r.applied.length} change(s) made` : "Nothing to change")(), onError: fail });
  const review = useMutation({ mutationFn: () => send("/review-now", "POST"), onSuccess: (r: { reviewed: number }) => done(`Checked ${r.reviewed} put-in(s)`)(), onError: fail });
  const revert = useMutation({ mutationFn: (id: number) => send(`/adjustments/${id}/revert`, "POST"), onSuccess: done("Put back — automatic changes paused for that meat"), onError: fail });
  const toggle = useMutation({
    mutationFn: (b: { id: number; on: boolean }) => send(`/ingredients/${b.id}`, "PUT", { autoLearn: b.on }),
    onSuccess: done("Saved"), onError: fail,
  });
  const saveSettings = useMutation({
    mutationFn: (b: Record<string, unknown>) => send("/settings", "PUT", b),
    onSuccess: done("Settings saved"), onError: fail,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>;
  if (isError || !data) return <p className="text-sm text-rose-600">{error instanceof Error ? error.message : "Couldn't load"}</p>;

  const reasonLabel = (code: string) => data.reasons.find(r => r.code === code)?.label ?? (code === "not_answered" ? "No reason given yet" : code);
  const numbers = ["reasonMinutes", "waitWeight", "bufferMaxMinutes"] as const;
  const dirty = numbers.some(k => (draft[k] ?? "") !== "");

  // Meats with days to learn from get a card, suggested changes first; the
  // rest are one short list (Graeme: too much shown by default).
  const withData = data.meats.filter(m => m.learning.status === "learned");
  const order = (m: MeatRow) => (m.learning.changes.length > 0 ? 0 : 1);
  const cards = [...withData].sort((a, b) => order(a) - order(b));
  const waiting = data.meats.filter(m => m.learning.status !== "learned");
  const suggested = withData.filter(m => m.learning.changes.length > 0).length;
  const recent = data.adjustments.slice(0, 10);

  return (
    <div className="space-y-5">
      {/* The two numbers that matter (Graeme, 2026-10-27). */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
        <div className="rounded-xl bg-secondary/50 p-4">
          <p className="text-4xl font-extrabold tabular-nums">{data.headline.avgSatMinutes ?? "—"}<span className="text-lg font-semibold"> min</span></p>
          <p className="text-base">Cooked meat sat waiting to be mixed, on average (last {data.headline.days} days)</p>
        </div>
        <div className={cn("rounded-xl p-4", data.headline.builderWaits > 0 ? "bg-rose-50 dark:bg-rose-900/20" : "bg-secondary/50")}>
          <p className="text-4xl font-extrabold tabular-nums">{data.headline.builderWaits}<span className="text-lg font-semibold"> times</span></p>
          <p className="text-base">The builders had to wait for a filling (last {data.headline.days} days)</p>
        </div>
      </div>
      {data.headline.measuredOverLimit > 0 && (
        <p className="text-sm font-semibold text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4" /> {data.headline.measuredOverLimit} of {data.headline.measuredChillDays} measured chills went over 4 hours.
        </p>
      )}

      <p className="text-base">
        {suggested > 0
          ? <><b>{suggested} {suggested === 1 ? "meat has" : "meats have"} a suggested change</b> — shown first. </>
          : "No changes suggested right now. "}
        <span className="text-muted-foreground">
          {data.settings.learningEnabled
            ? "Times are checked and adjusted by themselves after production each day."
            : "Automatic changes are switched off — nothing changes by itself."}
        </span>
      </p>

      {cards.length > 0 && (
        <div className="grid gap-3 grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3">
          {cards.map(m => (
            <MeatCard key={m.ingredientId} m={m} learningEnabled={data.settings.learningEnabled} canManage={canManage} busy={toggle.isPending}
              onToggle={on => toggle.mutate({ id: m.ingredientId, on })} />
          ))}
        </div>
      )}

      {waiting.length > 0 && (
        <div className="rounded-xl border border-border p-4 space-y-2">
          <p className="font-bold">Not enough days recorded yet — using the set times</p>
          <ul className="grid gap-x-6 gap-y-1 grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 text-sm">
            {waiting.map(m => (
              <li key={m.ingredientId} className="flex justify-between gap-3">
                <span className="font-medium">{m.name}</span>
                <span className="text-muted-foreground tabular-nums whitespace-nowrap">
                  {m.learning.status === "no_cook_time" ? "no cook time set" : m.configuredLeadMinutes != null ? `in ${m.configuredLeadMinutes} min before` : "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-lg font-bold">Changes made</h3>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing has been changed yet.</p>
        ) : (
          <ul className="space-y-2">
            {recent.map(a => {
              const diff = a.oldValue != null ? a.newValue - a.oldValue : null;
              return (
                <li key={a.id} className={cn("rounded-lg border border-border px-3 py-2 text-sm flex items-start justify-between gap-3", a.revertedAt && "opacity-60")}>
                  <div>
                    <p>
                      <b>{a.ingredientName}</b>{" "}
                      {diff != null && diff !== 0
                        ? <>goes in <b>{Math.abs(diff)} min {diff > 0 ? "earlier" : "later"}</b> ({adjustmentFieldLabel(a.field)} {a.oldValue} → {a.newValue} min)</>
                        : <>{adjustmentFieldLabel(a.field)} set to {a.newValue} min</>}
                    </p>
                    <p className="text-muted-foreground">
                      {a.source === "auto" ? "Changed automatically" : a.source === "revert" ? `Put back by ${a.actorName ?? "a manager"}` : `Changed by ${a.actorName ?? "a manager"}`}
                      {" · "}{formatUkDate(a.createdAt.slice(0, 10))} {new Date(a.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                    {a.revertedAt && <p className="text-xs">Put back by {a.revertedByName}</p>}
                  </div>
                  {canManage && a.source !== "revert" && !a.revertedAt && (
                    <button onClick={() => revert.mutate(a.id)} disabled={revert.isPending} className="min-h-[40px] px-3 rounded-lg border border-border inline-flex items-center gap-1.5 whitespace-nowrap">
                      <RotateCcw className="w-4 h-4" /> Put back
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Fold label={`This week: ${data.weekly.offTime} of ${data.weekly.putIns} put in at a different time`}>
        {data.weekly.byReason.length > 0 && (
          <p className="text-sm text-muted-foreground">Reasons given: {data.weekly.byReason.map(b => `${reasonLabel(b.code)} (${b.count})`).join(" · ")}</p>
        )}
        {data.weekly.items.length > 0 && (
          <ul className="grid gap-2 grid-cols-1 lg:grid-cols-2">
            {data.weekly.items.map(it => {
              const dev = it.deviationMinutes ?? 0;
              return (
                <li key={it.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                  <b>{it.ingredientName}</b> for {it.recipeName} · {formatUkDate(it.planDate)}: went in at {formatClock(it.putInMinutes)}
                  {it.suggestedAtMinutes != null && <>, {Math.abs(dev)} min {dev > 0 ? "late" : "early"} (suggested {formatClock(it.suggestedAtMinutes)})</>}
                  {" — "}{reasonLabel(it.reasonCode ?? "not_answered")}{it.reasonNote ? `: ${it.reasonNote}` : ""}
                </li>
              );
            })}
          </ul>
        )}
      </Fold>

      {canManage && <Fold label="Update now and settings">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => review.mutate()} disabled={review.isPending} className="min-h-[44px] px-4 rounded-xl border border-border font-medium disabled:opacity-50">
            {review.isPending ? "Checking…" : "Check today's put-ins now"}
          </button>
          <button onClick={() => run.mutate()} disabled={run.isPending} className="min-h-[44px] px-4 rounded-xl border-2 border-primary text-primary font-semibold disabled:opacity-50">
            {run.isPending ? "Changing…" : "Make the suggested changes now"}
          </button>
          {data.settings.lastAutoRun && <span className="text-sm text-muted-foreground">Last automatic update {formatUkDate(data.settings.lastAutoRun)}</span>}
        </div>
        {isAdmin && (
          <div className="flex flex-wrap items-end gap-4 border-t border-border pt-4">
            <NumberSetting label="Ask why if more than (min) off" min={3} max={60} placeholder={String(data.settings.reasonMinutes)} value={draft.reasonMinutes ?? ""} onChange={set("reasonMinutes")} />
            <NumberSetting label="A builder-wait minute counts as (× sitting)" min={1} max={20} placeholder={String(data.settings.waitWeight)} value={draft.waitWeight ?? ""} onChange={set("waitWeight")} />
            <NumberSetting label="Most spare time (min)" min={2} max={60} placeholder={String(data.settings.bufferMaxMinutes)} value={draft.bufferMaxMinutes ?? ""} onChange={set("bufferMaxMinutes")} />
            <label className="text-sm flex items-center gap-2 pb-2">
              <input type="checkbox" className="w-5 h-5" checked={data.settings.learningEnabled} onChange={e => saveSettings.mutate({ learningEnabled: e.target.checked })} />
              Change times automatically each day
            </label>
            <button
              disabled={saveSettings.isPending || !dirty}
              onClick={() => saveSettings.mutate(
                Object.fromEntries(numbers.filter(k => (draft[k] ?? "") !== "").map(k => [k, Number(draft[k])])),
                { onSuccess: () => setDraft({}) },
              )}
              className="min-h-[44px] px-4 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50"
            >
              {saveSettings.isPending ? "Saving…" : "Save settings"}
            </button>
          </div>
        )}
      </Fold>}
    </div>
  );
}

const TITLE = "Prep oven timings — self-correcting";

/** Recipes page: folded away until opened. */
export function MeatTimingLearningCard() {
  const { canManage } = useCanManage();
  const [open, setOpen] = useState(false);
  if (!canManage) return null;
  return (
    <section className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <button className="w-full flex items-center justify-between gap-3 text-left" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" /> {TITLE}</h2>
          <p className="text-sm text-muted-foreground">When each meat goes in the oven, any change suggested, and how the last few weeks went.</p>
        </div>
        {open ? <ChevronUp className="w-6 h-6" /> : <ChevronDown className="w-6 h-6" />}
      </button>
      {open && <MeatTimingReview />}
    </section>
  );
}

/** Mixing & Cooking station: opened from the Station menu (everyone; controls for managers). */
export function MeatTimingReviewDialog({ onClose }: { onClose: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={TITLE}
        onClick={e => e.stopPropagation()}
        className="bg-background border-2 border-border rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92dvh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-border shrink-0">
          <Sparkles className="w-6 h-6 text-primary shrink-0" />
          <h2 className="flex-1 font-display font-bold text-xl">{TITLE}</h2>
          <button onClick={onClose} className="w-11 h-11 rounded-lg flex items-center justify-center hover:bg-secondary" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4">
          <MeatTimingReview />
        </div>
      </div>
    </div>,
    document.body,
  );
}

