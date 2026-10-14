/**
 * Calendar setup (Graeme, 2026-10-14) — anyone with Sales & Marketing access edits everything the
 * email plan runs on: the weekly plan, the offers (code, wording, colour,
 * product-of-the-week, a subject idea per email), the Saturday ideas, the
 * pauses (Black Friday) and the UK key dates. Every field autosaves with a
 * visible save state. Objective I.
 *
 * Modal rule: X / Escape / tap outside to close, card capped at 92dvh with
 * internal scrolling, sized for phone and iPad.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2, X } from "lucide-react";
import {
  EMAIL_TYPE_LABELS, OFFER_EMAIL_TYPES, PLAN_DAY_TYPES, PRODUCT_TOKEN, WEEKDAYS_LONG, formatDay,
  type CyclePause, type KeyDate, type PlanDayType,
} from "@workspace/marketing-calendar";
import { cn } from "@/lib/utils";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import {
  createKeyDate, createOffer, createPause, deleteKeyDate, deleteOffer, deletePause, invalidateCycle, patchKeyDate, patchOffer, patchPause,
  saveSettings, type CycleResponse, type OfferPatch,
} from "./cycle-api";
import { OFFER_TONES } from "./constants";

type Offer = CycleResponse["config"]["offers"][number];

export function CycleSetup({ cycle, onClose }: { cycle: CycleResponse; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/50 flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Calendar setup" onClick={e => e.stopPropagation()}
        className="bg-card border-2 border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92dvh] flex flex-col">
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-border flex-shrink-0">
          <h2 className="flex-1 text-xl font-bold">Calendar setup</h2>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close"><X className="w-6 h-6" /></button>
        </div>
        <div className="overflow-y-auto p-4 sm:p-5 space-y-8">
          <p className="text-sm text-muted-foreground max-w-prose">
            Everything here saves as you go. Write <b>{PRODUCT_TOKEN}</b> in an offer's wording or subjects and it is filled with that week's product.
            Changes show on the list straight away; emails already made from the plan keep what they were made with.
          </p>
          <WeeklyPlan cycle={cycle} />
          <Offers cycle={cycle} />
          <FreeIdeas cycle={cycle} />
          <Pauses pauses={cycle.config.pauses} />
          <KeyDates keyDates={cycle.keyDates} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Section({ title, hint, children, action }: { title: string; hint?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold">{title}</h3>
          {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const inputCls = "w-full px-3 py-2.5 rounded-xl border-2 border-border bg-background text-base";

function useSaver<T>(save: (v: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useAutosave<T>(async v => { await save(v); await invalidateCycle(qc); });
}

// ── Weekly plan ─────────────────────────────────────────────────────────────
function WeeklyPlan({ cycle }: { cycle: CycleResponse }) {
  const [plan, setPlan] = useState<Array<PlanDayType | null>>(cycle.config.weeklyPlan);
  const save = useSaver<Array<PlanDayType | null>>(v => saveSettings({ weeklyPlan: v }));
  return (
    <Section title="Weekly plan" hint="Which email goes out on each day of an offer week." action={<SaveChip state={save.state} error={save.error} onRetry={save.flush} />}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {plan.map((t, i) => (
          <label key={i} className="space-y-1">
            <span className="text-sm font-semibold">{WEEKDAYS_LONG[i]}</span>
            <select value={t ?? ""} className={inputCls}
              onChange={e => { const next = plan.map((x, j) => (j === i ? ((e.target.value || null) as PlanDayType | null) : x)); setPlan(next); save.schedule(next); }}>
              <option value="">No email</option>
              {PLAN_DAY_TYPES.map(k => <option key={k} value={k}>{EMAIL_TYPE_LABELS[k]}</option>)}
            </select>
          </label>
        ))}
      </div>
    </Section>
  );
}

// ── Offers ──────────────────────────────────────────────────────────────────
function Offers({ cycle }: { cycle: CycleResponse }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const offers = cycle.config.offers;
  const add = async () => {
    setAdding(true); setErr(null);
    try {
      await createOffer({ code: `O${offers.length + 1} New offer`, name: "New offer — say what customers get", colour: Object.keys(OFFER_TONES)[offers.length % 8] });
      await invalidateCycle(qc);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't add it"); } finally { setAdding(false); }
  };
  const move = async (i: number, dir: -1 | 1) => {
    const a = offers[i], b = offers[i + dir];
    if (!a || !b) return;
    setErr(null);
    try {
      await Promise.all([patchOffer(a.id, { position: b.position === a.position ? i + dir : b.position }), patchOffer(b.id, { position: b.position === a.position ? i : a.position })]);
      await invalidateCycle(qc);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't move it"); }
  };
  return (
    <Section title="Offers" hint="They take turns, one per week, in this order; after the last it goes back to the first."
      action={<button type="button" onClick={() => void add()} disabled={adding} className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold inline-flex items-center gap-1.5 disabled:opacity-60">
        {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add offer</button>}>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="space-y-4">
        {offers.map((o, i) => (
          <OfferCard key={o.id} offer={o} number={i + 1} first={i === 0} last={i === offers.length - 1} onMove={d => void move(i, d)} />
        ))}
      </div>
    </Section>
  );
}

function OfferCard({ offer, number, first, last, onMove }: { offer: Offer; number: number; first: boolean; last: boolean; onMove: (d: -1 | 1) => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState(offer);
  const [confirm, setConfirm] = useState(false);
  const save = useSaver<OfferPatch>(v => patchOffer(offer.id, v));
  const set = (patch: OfferPatch) => {
    const next = { ...d, ...patch, subjects: { ...d.subjects, ...(patch.subjects ?? {}) } } as Offer;
    setD(next);
    save.schedule({ code: next.code, name: next.name, tag: next.tag || null, colour: next.colour, featuresProduct: next.featuresProduct, subjects: next.subjects });
  };
  const tone = OFFER_TONES[d.colour] ?? OFFER_TONES.green;
  return (
    <div className={cn("rounded-2xl border-2 border-border border-l-[6px] p-4 space-y-3", tone.edge)}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn("text-xs font-bold px-2 py-1 rounded-md", tone.chip)}>Offer {number}</span>
        <span className="flex-1" />
        <SaveChip state={save.state} error={save.error} onRetry={save.flush} />
        <button type="button" disabled={first} onClick={() => onMove(-1)} className="p-2 rounded-lg border-2 border-border disabled:opacity-30" aria-label="Move earlier"><ArrowUp className="w-4 h-4" /></button>
        <button type="button" disabled={last} onClick={() => onMove(1)} className="p-2 rounded-lg border-2 border-border disabled:opacity-30" aria-label="Move later"><ArrowDown className="w-4 h-4" /></button>
        {confirm ? (
          <span className="flex items-center gap-2">
            <button type="button" onClick={async () => { await deleteOffer(offer.id); await invalidateCycle(qc); }} className="px-3 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-semibold">Remove offer {number}</button>
            <button type="button" onClick={() => setConfirm(false)} className="px-3 py-2 rounded-lg border-2 border-border text-sm font-semibold">Keep</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className="p-2 rounded-lg border-2 border-border text-destructive" aria-label="Remove offer"><Trash2 className="w-4 h-4" /></button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1"><span className="text-sm font-semibold">Offer (as customers read it)</span>
          <input className={inputCls} value={d.name} maxLength={200} onChange={e => set({ name: e.target.value })} onBlur={() => void save.flush()} /></label>
        <label className="space-y-1"><span className="text-sm font-semibold">Code in campaign names</span>
          <input className={inputCls} value={d.code} maxLength={80} onChange={e => set({ code: e.target.value })} onBlur={() => void save.flush()} /></label>
        <label className="space-y-1"><span className="text-sm font-semibold">Tag <span className="font-normal text-muted-foreground">optional, e.g. Standard</span></span>
          <input className={inputCls} value={d.tag ?? ""} maxLength={40} onChange={e => set({ tag: e.target.value })} onBlur={() => void save.flush()} /></label>
        <div className="space-y-1">
          <span className="text-sm font-semibold">Colour</span>
          <div className="flex flex-wrap gap-2">
            {Object.entries(OFFER_TONES).map(([k, t]) => (
              <button key={k} type="button" onClick={() => set({ colour: k })} aria-pressed={d.colour === k} aria-label={t.label}
                className={cn("w-10 h-10 rounded-xl border-4", t.swatch, d.colour === k ? "border-foreground" : "border-transparent")} />
            ))}
          </div>
        </div>
      </div>
      <label className="flex items-center gap-3 text-base font-semibold cursor-pointer">
        <input type="checkbox" className="w-6 h-6" checked={d.featuresProduct} onChange={e => set({ featuresProduct: e.target.checked })} />
        Features a product of the week (fills {PRODUCT_TOKEN})
      </label>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {OFFER_EMAIL_TYPES.map(t => (
          <label key={t} className="space-y-1"><span className="text-sm font-semibold">{EMAIL_TYPE_LABELS[t]} subject idea</span>
            <input className={inputCls} value={d.subjects[t] ?? ""} maxLength={200} onChange={e => set({ subjects: { [t]: e.target.value } })} onBlur={() => void save.flush()} /></label>
        ))}
      </div>
    </div>
  );
}

// ── Saturday ideas ──────────────────────────────────────────────────────────
function FreeIdeas({ cycle }: { cycle: CycleResponse }) {
  const [ideas, setIdeas] = useState(cycle.config.freeIdeas);
  const save = useSaver<Array<{ idea: string; subject: string }>>(v => saveSettings({ freeSlotIdeas: v.filter(x => x.idea.trim() && x.subject.trim()) }));
  const update = (next: typeof ideas) => { setIdeas(next); save.schedule(next); };
  return (
    <Section title="Free slot ideas" hint="One a week, in turn, for the free (random or creative) email."
      action={<span className="flex items-center gap-2"><SaveChip state={save.state} error={save.error} onRetry={save.flush} />
        <button type="button" onClick={() => setIdeas([...ideas, { idea: "", subject: "" }])} className="px-4 py-2.5 rounded-xl border-2 border-border font-semibold inline-flex items-center gap-1.5"><Plus className="w-4 h-4" /> Add idea</button></span>}>
      <div className="space-y-3">
        {ideas.map((x, i) => (
          <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-end">
            <label className="space-y-1"><span className="text-sm font-semibold">Idea</span>
              <input className={inputCls} value={x.idea} maxLength={120} onChange={e => update(ideas.map((y, j) => (j === i ? { ...y, idea: e.target.value } : y)))} onBlur={() => void save.flush()} /></label>
            <label className="space-y-1"><span className="text-sm font-semibold">Subject idea</span>
              <input className={inputCls} value={x.subject} maxLength={200} onChange={e => update(ideas.map((y, j) => (j === i ? { ...y, subject: e.target.value } : y)))} onBlur={() => void save.flush()} /></label>
            <button type="button" onClick={() => update(ideas.filter((_, j) => j !== i))} className="p-3 rounded-xl border-2 border-border text-destructive" aria-label="Remove idea"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Pauses ──────────────────────────────────────────────────────────────────
function Pauses({ pauses }: { pauses: CyclePause[] }) {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const add = async () => {
    setErr(null);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
    try { await createPause({ name: "New pause", startDate: today, endDate: today }); await invalidateCycle(qc); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't add it"); }
  };
  return (
    <Section title="Pauses" hint="The cycle stops for these dates (the planner's own emails run instead) and carries on with the next offer after."
      action={<button type="button" onClick={() => void add()} className="px-4 py-2.5 rounded-xl border-2 border-border font-semibold inline-flex items-center gap-1.5"><Plus className="w-4 h-4" /> Add pause</button>}>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="space-y-3">
        {pauses.map(p => <PauseRow key={p.id} pause={p} />)}
        {pauses.length === 0 && <p className="text-sm text-muted-foreground">No pauses.</p>}
      </div>
    </Section>
  );
}

function PauseRow({ pause }: { pause: CyclePause }) {
  const qc = useQueryClient();
  const [d, setD] = useState(pause);
  const save = useSaver<CyclePause>(v => patchPause(pause.id, { name: v.name, startDate: v.startDate, endDate: v.endDate }));
  const set = (patch: Partial<CyclePause>) => { const next = { ...d, ...patch }; setD(next); if (next.name.trim() && next.endDate >= next.startDate) save.schedule(next); };
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_11rem_11rem_auto] gap-2 items-end">
      <label className="space-y-1"><span className="text-sm font-semibold">Name</span>
        <input className={inputCls} value={d.name} maxLength={120} onChange={e => set({ name: e.target.value })} /></label>
      <label className="space-y-1"><span className="text-sm font-semibold">From</span>
        <input type="date" className={inputCls} value={d.startDate} onChange={e => set({ startDate: e.target.value })} /></label>
      <label className="space-y-1"><span className="text-sm font-semibold">To</span>
        <input type="date" className={inputCls} value={d.endDate} onChange={e => set({ endDate: e.target.value })} /></label>
      <span className="flex items-center gap-2 pb-1">
        <SaveChip state={save.state} error={save.error} onRetry={save.flush} />
        <button type="button" onClick={async () => { await deletePause(pause.id); await invalidateCycle(qc); }} className="p-3 rounded-xl border-2 border-border text-destructive" aria-label={`Remove ${pause.name}`}><Trash2 className="w-4 h-4" /></button>
      </span>
      {d.endDate < d.startDate && <p className="md:col-span-4 text-sm text-destructive">The end can't be before the start — not saved yet.</p>}
    </div>
  );
}

// ── Key dates ───────────────────────────────────────────────────────────────
function KeyDates({ keyDates }: { keyDates: KeyDate[] }) {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const add = async () => {
    setErr(null);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
    try { await createKeyDate({ date: today, name: "New key date" }); await invalidateCycle(qc); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't add it"); }
  };
  return (
    <Section title="UK key dates" hint="Shown on their day. A big one warns that week's offer may need to change."
      action={<button type="button" onClick={() => void add()} className="px-4 py-2.5 rounded-xl border-2 border-border font-semibold inline-flex items-center gap-1.5"><Plus className="w-4 h-4" /> Add key date</button>}>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="space-y-2">
        {keyDates.map(k => <KeyDateRow key={k.id} keyDate={k} />)}
      </div>
    </Section>
  );
}

function KeyDateRow({ keyDate }: { keyDate: KeyDate }) {
  const qc = useQueryClient();
  const [d, setD] = useState(keyDate);
  const save = useSaver<KeyDate>(v => patchKeyDate(keyDate.id, { date: v.date, name: v.name, big: v.big }));
  const set = (patch: Partial<KeyDate>) => { const next = { ...d, ...patch }; setD(next); if (next.name.trim() && /^\d{4}-\d{2}-\d{2}$/.test(next.date)) save.schedule(next); };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[11rem_1fr_auto_auto] gap-2 items-center">
      <input type="date" aria-label="Date" className={inputCls} value={d.date} onChange={e => set({ date: e.target.value })} />
      <input aria-label="Name" className={inputCls} value={d.name} maxLength={120} onChange={e => set({ name: e.target.value })} title={formatDay(d.date)} />
      <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
        <input type="checkbox" className="w-5 h-5" checked={d.big} onChange={e => set({ big: e.target.checked })} /> Big
      </label>
      <span className="flex items-center gap-2">
        <SaveChip state={save.state} error={save.error} onRetry={save.flush} />
        <button type="button" onClick={async () => { await deleteKeyDate(keyDate.id); await invalidateCycle(qc); }} className="p-3 rounded-xl border-2 border-border text-destructive" aria-label={`Remove ${keyDate.name}`}><Trash2 className="w-4 h-4" /></button>
      </span>
    </div>
  );
}
