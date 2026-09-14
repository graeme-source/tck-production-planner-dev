/**
 * Return-to-work forms (Graeme, 2026-09-14). A colleague completes this
 * WITH a manager after a spell of sick leave. Privacy: only the colleague
 * and the named RTW managers (Graeme + Lorna) can see the content — the
 * server enforces it; this page just shows what it's allowed.
 *
 * Reached from the chase to-do ("complete your return-to-work form"), or —
 * for RTW managers — from the sick-leave numbers on the Employee Records
 * report (?user=<id> works on that colleague's forms).
 */
import { useRef, useState } from "react";
import { useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, HeartPulse, CheckCircle2, ChevronLeft, Lock, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface RtwForm {
  id: number;
  userId: number;
  userName: string | null;
  absenceStart: string;
  absenceEnd: string | null;
  returnDate: string | null;
  reasonCategory: string | null;
  reasonDetails: string | null;
  supportNotes: string | null;
  doctorSeen: boolean | null;
  workRelated: boolean | null;
  managerName: string | null;
  colleagueSignedAt: string | null;
  managerSignedAt: string | null;
  status: string;
  createdAt: string;
}

interface SickSpell { start: string; end: string; days: number; returned: boolean; formId: number | null; formStatus: string | null }

const REASONS = ["Illness", "Injury", "Medical appointment / procedure", "Stress or mental health", "Other"];

function fmtRange(start: string, end: string | null) {
  const f = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return !end || end === start ? f(start) : `${f(start)} – ${f(end)}`;
}

/** Debounced autosave with a visible state, per the charter. */
function useAutosave(formId: number | null) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = (fields: Record<string, unknown>) => {
    if (formId == null) return;
    if (timer.current) clearTimeout(timer.current);
    setState("saving");
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`${BASE}/api/return-to-work/${formId}`, {
          method: "PATCH", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fields),
        });
        if (!r.ok) throw new Error();
        setState("saved");
      } catch {
        setState("error");
      }
    }, 500);
  };
  return { state, save };
}

function FormEditor({ form, onDone, onBack }: { form: RtwForm; onDone: () => void; onBack: () => void }) {
  const [f, setF] = useState(form);
  const { state: saveState, save } = useAutosave(form.id);
  const [signing, setSigning] = useState(false);
  const readOnly = f.status === "complete";

  const set = <K extends keyof RtwForm>(key: K, value: RtwForm[K], patchKey: string) => {
    setF(prev => ({ ...prev, [key]: value }));
    save({ [patchKey]: value });
  };

  const sign = async () => {
    setSigning(true);
    try {
      const r = await fetch(`${BASE}/api/return-to-work/${form.id}/complete`, { method: "POST", credentials: "include" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast({ title: "Not signed yet", description: d.error ?? "Try again", variant: "destructive" }); return; }
      toast({ title: "Return-to-work form signed", description: "Thanks — it's filed, and only you, Graeme and Lorna can see it." });
      onDone();
    } finally {
      setSigning(false);
    }
  };

  const inputCls = "w-full px-3 py-2.5 bg-background border border-border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60";

  return (
    <div className="bg-card border-2 border-border rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-secondary" aria-label="Back to the list"><ChevronLeft className="w-5 h-5" /></button>
        <h2 className="font-display font-bold text-xl flex-1 min-w-0">
          {f.userName ?? "Return to work"} — off sick {fmtRange(f.absenceStart, f.absenceEnd)}
        </h2>
        {readOnly ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600"><CheckCircle2 className="w-4 h-4" /> Signed</span>
        ) : (
          <span className={cn("text-xs font-medium",
            saveState === "saving" ? "text-muted-foreground" :
            saveState === "saved" ? "text-emerald-600" :
            saveState === "error" ? "text-red-600" : "text-transparent")}>
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Not saved — check connection" : "."}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-semibold block mb-1">First day back at work</label>
          <input type="date" disabled={readOnly} value={f.returnDate ?? ""} onChange={e => set("returnDate", e.target.value || null, "returnDate")} className={inputCls} />
        </div>
        <div>
          <label className="text-sm font-semibold block mb-1">Reason for absence <span className="text-destructive">*</span></label>
          <select disabled={readOnly} value={f.reasonCategory ?? ""} onChange={e => set("reasonCategory", e.target.value || null, "reasonCategory")} className={inputCls}>
            <option value="">Choose…</option>
            {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="text-sm font-semibold block mb-1">What happened?</label>
        <textarea disabled={readOnly} value={f.reasonDetails ?? ""} onChange={e => set("reasonDetails", e.target.value || null, "reasonDetails")}
          placeholder="A few sentences — enough that we understand and can help."
          className={cn(inputCls, "min-h-[110px]")} />
      </div>

      <div>
        <label className="text-sm font-semibold block mb-1">Anything we should change or support you with?</label>
        <textarea disabled={readOnly} value={f.supportNotes ?? ""} onChange={e => set("supportNotes", e.target.value || null, "supportNotes")}
          placeholder="Adjustments discussed, lighter duties, follow-ups — or 'nothing needed'."
          className={cn(inputCls, "min-h-[80px]")} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-semibold block mb-1">Saw a doctor / has a fit note?</label>
          <select disabled={readOnly} value={f.doctorSeen == null ? "" : f.doctorSeen ? "yes" : "no"}
            onChange={e => set("doctorSeen", e.target.value === "" ? null : e.target.value === "yes", "doctorSeen")} className={inputCls}>
            <option value="">—</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-semibold block mb-1">Work-related?</label>
          <select disabled={readOnly} value={f.workRelated == null ? "" : f.workRelated ? "yes" : "no"}
            onChange={e => set("workRelated", e.target.value === "" ? null : e.target.value === "yes", "workRelated")} className={inputCls}>
            <option value="">—</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
      </div>

      <div>
        <label className="text-sm font-semibold block mb-1">Manager you completed this with <span className="text-destructive">*</span></label>
        <input type="text" disabled={readOnly} value={f.managerName ?? ""} onChange={e => set("managerName", e.target.value || null, "managerName")}
          placeholder="e.g. Lorna" className={inputCls} />
      </div>

      {!readOnly && (
        <button onClick={sign} disabled={signing}
          className="w-full h-14 rounded-xl bg-primary text-primary-foreground font-bold text-lg flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50">
          {signing ? <Loader2 className="w-5 h-5 animate-spin" /> : <PenLine className="w-5 h-5" />} Sign & complete together
        </button>
      )}

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Lock className="w-3.5 h-3.5" /> Private — visible only to {f.userName ?? "you"}, Graeme and Lorna.
      </p>
    </div>
  );
}

export default function ReturnToWorkPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const forUser = params.get("user") != null ? Number(params.get("user")) : null;
  const queryClient = useQueryClient();
  const [openForm, setOpenForm] = useState<RtwForm | null>(null);
  const [starting, setStarting] = useState(false);

  const { data: mine, isLoading } = useQuery<{ forms: RtwForm[]; due: SickSpell[]; isRtwManager: boolean }>({
    queryKey: ["rtw-mine"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/return-to-work/mine`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
  });
  const managerView = forUser != null && mine?.isRtwManager === true;
  const { data: subject } = useQuery<{ forms: RtwForm[]; spells: SickSpell[] }>({
    queryKey: ["rtw-user", forUser],
    enabled: managerView,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/return-to-work/user/${forUser}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
  });

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["rtw-mine"] });
    void queryClient.invalidateQueries({ queryKey: ["rtw-user"] });
  };

  const startForm = async (spell: SickSpell, userId?: number) => {
    setStarting(true);
    try {
      const r = await fetch(`${BASE}/api/return-to-work`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absenceStart: spell.start, absenceEnd: spell.end, ...(userId != null ? { userId } : {}) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Failed");
      const fr = await fetch(`${BASE}/api/return-to-work/form/${d.id}`, { credentials: "include" });
      setOpenForm(await fr.json());
      refreshAll();
    } catch (err) {
      toast({ title: "Couldn't open the form", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    } finally {
      setStarting(false);
    }
  };

  const openExisting = async (id: number) => {
    const r = await fetch(`${BASE}/api/return-to-work/form/${id}`, { credentials: "include" });
    if (r.ok) setOpenForm(await r.json());
  };

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  if (openForm) {
    return (
      <div className="max-w-2xl mx-auto pb-24">
        <FormEditor form={openForm} onBack={() => { setOpenForm(null); refreshAll(); }} onDone={() => { setOpenForm(null); refreshAll(); }} />
      </div>
    );
  }

  const forms = managerView ? (subject?.forms ?? []) : (mine?.forms ?? []);
  const due = managerView ? (subject?.spells ?? []).filter(s => s.returned && s.formId == null) : (mine?.due ?? []);
  const heading = managerView
    ? `Return to work — ${subject?.forms[0]?.userName ?? "colleague"}`
    : "Return to work";

  return (
    <div className="max-w-2xl mx-auto pb-24 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-rose-100 dark:bg-rose-950/40 flex items-center justify-center">
          <HeartPulse className="w-6 h-6 text-rose-600" />
        </div>
        <div>
          <h1 className="font-display font-bold text-2xl leading-tight">{heading}</h1>
          <p className="text-sm text-muted-foreground flex items-center gap-1"><Lock className="w-3 h-3" /> Private — you, Graeme and Lorna only.</p>
        </div>
      </div>

      {due.map(spell => (
        <div key={spell.start} className="rounded-2xl border-2 border-amber-400 dark:border-amber-700 bg-amber-50/80 dark:bg-amber-950/30 p-4 space-y-2">
          <p className="font-bold text-amber-900 dark:text-amber-100">
            {managerView ? "They were" : "You were"} off sick {fmtRange(spell.start, spell.end)} ({spell.days} day{spell.days !== 1 ? "s" : ""})
          </p>
          <p className="text-sm text-amber-800/90 dark:text-amber-200/90">
            {managerView ? "Sit down together and complete the return-to-work form." : "Grab a manager and fill in the short return-to-work form together — it takes two minutes."}
          </p>
          <button onClick={() => startForm(spell, managerView ? forUser! : undefined)} disabled={starting}
            className="h-12 px-5 rounded-xl bg-amber-600 text-white font-bold flex items-center gap-2 disabled:opacity-50">
            {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenLine className="w-4 h-4" />} Start the form
          </button>
        </div>
      ))}

      {forms.length === 0 && due.length === 0 && (
        <p className="text-muted-foreground">Nothing here — no sick leave needing a form. Long may it last.</p>
      )}

      {forms.map(form => (
        <button key={form.id} onClick={() => openExisting(form.id)}
          className="w-full text-left rounded-2xl border-2 border-border bg-card p-4 hover:border-primary/50 transition-colors flex items-center gap-3">
          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
            form.status === "complete" ? "bg-emerald-100 dark:bg-emerald-950/40" : "bg-amber-100 dark:bg-amber-950/40")}>
            {form.status === "complete" ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <PenLine className="w-5 h-5 text-amber-600" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{fmtRange(form.absenceStart, form.absenceEnd)}{form.reasonCategory ? ` — ${form.reasonCategory}` : ""}</p>
            {/* The note shows inline so a scan down the list reads the
                actual reasons, not just the category. */}
            {form.reasonDetails && (
              <p className="text-sm text-foreground/80 line-clamp-2">{form.reasonDetails}</p>
            )}
            <p className="text-sm text-muted-foreground truncate">
              {form.status === "complete" ? `Signed${form.managerName ? ` with ${form.managerName}` : ""}` : "Draft — finish and sign with a manager"}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}
