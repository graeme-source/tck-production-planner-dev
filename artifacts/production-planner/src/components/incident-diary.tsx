/**
 * Accident & incident diary — HACCP due diligence (Graeme, 2026-09-11:
 * the broken oven-door glass. "I just want to document this, all in our
 * system, in an easy way").
 *
 * One tap starts a report, auto-dated with the reporter recorded. Every
 * field autosaves on blur (visible saved state), the standard containment
 * steps are big tickable cards, and a signature puts the manager's name
 * to the record. Lives under Reports → HACCP; managers and admins only
 * (the API router is behind the same guard).
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Plus, Loader2, Check, ChevronDown, ChevronUp, ShieldAlert, PenLine,
  Trash2, CheckCircle2, AlertTriangle, MapPin, Ban, Utensils, ClipboardCheck, Sparkles,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface IncidentReport {
  id: number;
  kind: "accident" | "incident" | "near_miss";
  occurredAt: string;
  title: string;
  location: string | null;
  description: string | null;
  peopleInvolved: string | null;
  injuries: string | null;
  foodSafetyImpact: string | null;
  immediateActions: string | null;
  correctiveActions: string | null;
  productionStopped: boolean;
  foodDiscarded: boolean;
  riskAssessmentDone: boolean;
  areaCleaned: boolean;
  status: "open" | "closed";
  reportedByName: string | null;
  signedByName: string | null;
  signedAt: string | null;
  closedAt: string | null;
}

const KIND_META: Record<IncidentReport["kind"], { label: string; chip: string }> = {
  accident: { label: "Accident", chip: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
  incident: { label: "Incident", chip: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  near_miss: { label: "Near miss", chip: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200" },
};

const STEPS: Array<{ key: "productionStopped" | "foodDiscarded" | "riskAssessmentDone" | "areaCleaned"; label: string; hint: string; icon: typeof Ban }> = [
  { key: "productionStopped", label: "Production stopped in the area", hint: "Nothing made or handled there until it's safe", icon: Ban },
  { key: "foodDiscarded", label: "At-risk food thrown away", hint: "Anything exposed or nearby, disposed and noted below", icon: Utensils },
  { key: "riskAssessmentDone", label: "Risk assessment carried out", hint: "What could have been contaminated, and how far", icon: ClipboardCheck },
  { key: "areaCleaned", label: "Area cleaned & sanitised", hint: "Full clean-down before production resumes", icon: Sparkles },
];

export function IncidentDiaryTab() {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<number | null>(null);

  const { data: reports = [], isLoading } = useQuery<IncidentReport[]>({
    queryKey: ["incident-reports"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/incidents`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load the diary");
      return res.json();
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["incident-reports"] });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/incidents`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to create");
      return res.json() as Promise<IncidentReport>;
    },
    onSuccess: (row) => {
      invalidate();
      setOpenId(row.id);
      toast({ title: "Report started", description: "Auto-dated to now — fill it in below, everything saves as you go." });
    },
    onError: (e) => toast({ title: "Couldn't start a report", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-primary" /> Accident &amp; Incident Diary
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            The HACCP record of anything that went wrong and what we did about it. Reports are auto-dated,
            autosave as you type, and are signed by the manager who dealt with it.
          </p>
        </div>
        <button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 disabled:opacity-60 inline-flex items-center gap-2"
        >
          {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          New report
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : reports.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <ShieldAlert className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No incidents on record</p>
          <p className="text-sm mt-1">Long may it last. When something happens, one tap on New report starts the paperwork.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map(r => (
            <ReportCard
              key={r.id}
              report={r}
              open={openId === r.id}
              onToggle={() => setOpenId(openId === r.id ? null : r.id)}
              onChanged={invalidate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReportCard({ report, open, onToggle, onChanged }: {
  report: IncidentReport;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const kind = KIND_META[report.kind];
  const stepsDone = STEPS.filter(s => report[s.key]).length;
  return (
    <div className={cn("rounded-2xl border-2 bg-card overflow-hidden", report.status === "closed" ? "border-border" : "border-amber-400/60")}>
      <button onClick={onToggle} className="w-full text-left p-4 flex items-center gap-3 hover:bg-secondary/20 transition-colors">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("px-2 py-0.5 rounded-full text-xs font-bold", kind.chip)}>{kind.label}</span>
            <span className="text-sm font-semibold tabular-nums">{format(new Date(report.occurredAt), "EEE d MMM yyyy, HH:mm")}</span>
            {report.location && (
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{report.location}</span>
            )}
            {report.status === "closed" ? (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-secondary text-muted-foreground">Closed</span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Open</span>
            )}
          </div>
          <p className="text-base font-bold truncate">{report.title || <span className="text-muted-foreground font-medium">Untitled — tap to fill in</span>}</p>
          <p className="text-xs text-muted-foreground">
            {report.reportedByName ? `Reported by ${report.reportedByName}` : ""}
            {" · "}{stepsDone}/{STEPS.length} containment steps
            {report.signedAt && report.signedByName ? ` · Signed by ${report.signedByName}, ${format(new Date(report.signedAt), "d MMM HH:mm")}` : " · not signed yet"}
          </p>
        </div>
        {open ? <ChevronUp className="w-5 h-5 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-5 h-5 text-muted-foreground flex-shrink-0" />}
      </button>
      {open && <ReportDetail report={report} onChanged={onChanged} />}
    </div>
  );
}

function ReportDetail({ report, onChanged }: { report: IncidentReport; onChanged: () => void }) {
  const patch = async (body: Record<string, unknown>) => {
    const res = await fetch(`${BASE}/api/incidents/${report.id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to save");
    onChanged();
  };

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const action = async (name: string, fn: () => Promise<void>) => {
    setBusyAction(name);
    try {
      await fn();
    } catch (e) {
      toast({ title: "That didn't save", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusyAction(null);
    }
  };

  const sign = () => action("sign", async () => {
    const res = await fetch(`${BASE}/api/incidents/${report.id}/sign`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: "{}",
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to sign");
    onChanged();
    toast({ title: "Signed", description: "Your name and the time are on the report." });
  });

  const closeOrReopen = (reopen: boolean) => action("close", async () => {
    const res = await fetch(`${BASE}/api/incidents/${report.id}/close`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reopen }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed");
    onChanged();
  });

  const remove = () => action("delete", async () => {
    if (!confirm("Delete this unsigned draft report?")) return;
    const res = await fetch(`${BASE}/api/incidents/${report.id}`, { method: "DELETE", credentials: "include" });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to delete");
    onChanged();
  });

  // datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
  const occurredLocal = (() => {
    const d = new Date(report.occurredAt);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();

  return (
    <div className="border-t border-border p-4 space-y-5">
      {/* When / what kind / where */}
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          When it happened
          <input
            type="datetime-local"
            defaultValue={occurredLocal}
            onBlur={e => {
              if (e.target.value && e.target.value !== occurredLocal) {
                void action("when", () => patch({ occurredAt: new Date(e.target.value).toISOString() }));
              }
            }}
            className="mt-1 block w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm font-normal normal-case"
          />
        </label>
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Type
          <select
            defaultValue={report.kind}
            onChange={e => void action("kind", () => patch({ kind: e.target.value }))}
            className="mt-1 block w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm font-normal normal-case"
          >
            <option value="accident">Accident (someone hurt, or could have been)</option>
            <option value="incident">Incident (equipment, contamination, damage)</option>
            <option value="near_miss">Near miss</option>
          </select>
        </label>
        <AutosaveField label="Where in the factory" value={report.location ?? ""} placeholder="e.g. Oven area" onSave={v => patch({ location: v || null })} />
      </div>

      <AutosaveField label="What happened (one line)" value={report.title} placeholder="e.g. Tempered glass oven door shattered onto the floor" onSave={v => patch({ title: v })} />
      <AutosaveField label="Full description" value={report.description ?? ""} multiline placeholder="What happened, how, and what was affected…" onSave={v => patch({ description: v || null })} />

      {/* The standard containment steps — big tickable cards. */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Containment — the standard steps</p>
        <div className="grid sm:grid-cols-2 gap-2">
          {STEPS.map(s => {
            const on = report[s.key];
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                onClick={() => void action(s.key, () => patch({ [s.key]: !on }))}
                disabled={busyAction === s.key}
                className={cn(
                  "text-left rounded-xl border-2 p-3 flex items-start gap-3 transition-colors",
                  on ? "border-emerald-500/70 bg-emerald-500/10" : "border-border hover:bg-secondary/30",
                )}
              >
                <span className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0",
                  on ? "bg-emerald-500 text-white" : "border-2 border-border text-muted-foreground",
                )}>
                  {busyAction === s.key ? <Loader2 className="w-4 h-4 animate-spin" /> : on ? <Check className="w-4 h-4" /> : <Icon className="w-3.5 h-3.5" />}
                </span>
                <span>
                  <span className="block text-sm font-semibold">{s.label}</span>
                  <span className="block text-xs text-muted-foreground">{s.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <AutosaveField label="People involved / witnesses" value={report.peopleInvolved ?? ""} multiline placeholder="Who was there, who dealt with it" onSave={v => patch({ peopleInvolved: v || null })} />
        <AutosaveField label="Injuries & first aid" value={report.injuries ?? ""} multiline placeholder="None / what was treated and by whom" onSave={v => patch({ injuries: v || null })} />
        <AutosaveField label="Food safety impact" value={report.foodSafetyImpact ?? ""} multiline placeholder="What food was at risk, what was thrown away" onSave={v => patch({ foodSafetyImpact: v || null })} />
        <AutosaveField label="Immediate actions taken" value={report.immediateActions ?? ""} multiline placeholder="Stopped production, cordoned area, initial clean-up…" onSave={v => patch({ immediateActions: v || null })} />
      </div>
      <AutosaveField label="Corrective actions — stop it happening again" value={report.correctiveActions ?? ""} multiline placeholder="Full clean-down after production, door replacement, checks added…" onSave={v => patch({ correctiveActions: v || null })} />

      {/* Signature + lifecycle */}
      <div className="rounded-xl border border-border bg-secondary/20 p-4 flex items-center justify-between gap-3 flex-wrap">
        {report.signedAt && report.signedByName ? (
          <p className="text-sm inline-flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            Signed by <b>{report.signedByName}</b> on {format(new Date(report.signedAt), "d MMM yyyy 'at' HH:mm")}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground inline-flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" /> Not signed yet — sign once the details are right.
          </p>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {!report.signedAt && (
            <button onClick={remove} disabled={busyAction !== null}
              className="px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 inline-flex items-center gap-1.5">
              <Trash2 className="w-4 h-4" /> Delete draft
            </button>
          )}
          <button onClick={sign} disabled={busyAction !== null}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 disabled:opacity-60 inline-flex items-center gap-1.5">
            {busyAction === "sign" ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenLine className="w-4 h-4" />}
            {report.signedAt ? "Sign again" : "Sign this report"}
          </button>
          {report.status === "open" ? (
            <button onClick={() => closeOrReopen(false)} disabled={busyAction !== null}
              className="px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-secondary/40 disabled:opacity-60">
              Close report
            </button>
          ) : (
            <button onClick={() => closeOrReopen(true)} disabled={busyAction !== null}
              className="px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-secondary/40 disabled:opacity-60">
              Reopen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Autosave-on-blur text field with a visible saved tick. */
function AutosaveField({ label, value, placeholder, multiline = false, onSave }: {
  label: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  onSave: (value: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  useEffect(() => { setDraft(value); }, [value]);

  const save = async () => {
    if (draft === value) return;
    setState("saving");
    try {
      await onSave(draft);
      setState("saved");
      setTimeout(() => setState(s => (s === "saved" ? "idle" : s)), 2000);
    } catch (e) {
      setState("error");
      toast({ title: "That didn't save", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const cls = "mt-1 block w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm font-normal normal-case focus:outline-none focus:ring-2 focus:ring-primary/30";
  return (
    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">
      <span className="inline-flex items-center gap-1.5">
        {label}
        {state === "saving" && <Loader2 className="w-3 h-3 animate-spin text-primary" />}
        {state === "saved" && <span className="text-emerald-600 normal-case font-medium inline-flex items-center gap-0.5"><Check className="w-3 h-3" /> saved</span>}
        {state === "error" && <span className="text-destructive normal-case font-medium">not saved</span>}
      </span>
      {multiline ? (
        <textarea rows={3} value={draft} placeholder={placeholder} onChange={e => setDraft(e.target.value)} onBlur={save} className={cls} />
      ) : (
        <input value={draft} placeholder={placeholder} onChange={e => setDraft(e.target.value)} onBlur={save} className={cls} />
      )}
    </label>
  );
}
