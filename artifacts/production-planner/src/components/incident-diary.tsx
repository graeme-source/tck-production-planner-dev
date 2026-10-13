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
 *
 * The report form (IncidentReportDetail) is also used by the quick-actions
 * "Report accident / incident" pop-up (report-incident-modal.tsx).
 *
 * Lock (Graeme, 2026-10-13): once signed, the report is read-only. A
 * manager can "Unlock to update" with a reason; it then shows "needs
 * signing again" until re-signed, and the History section shows every
 * signed version, every unlock, and what changed. Photos can always be
 * added. Server rules: api-server/src/lib/incident-lock-rules.ts.
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Plus, Loader2, Check, ChevronDown, ChevronUp, ShieldAlert, PenLine,
  Trash2, CheckCircle2, AlertTriangle, MapPin, Ban, Utensils, ClipboardCheck, Sparkles,
  Lock, Unlock, History,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { IncidentAttachments } from "@/components/incident-attachments";
import { INCIDENT_KIND_LABEL, INCIDENT_KIND_OPTIONS, type IncidentKind } from "@/lib/incident-kinds";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const INCIDENT_REPORTS_KEY = ["incident-reports"] as const;
const historyKey = (id: number) => ["incident-history", id] as const;

export interface IncidentReport {
  id: number;
  kind: IncidentKind;
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
  /** How many times it has been signed (0 = never). */
  signedVersion: number;
  unlockedAt: string | null;
  unlockedByName: string | null;
  unlockReason: string | null;
  /** Live (not removed) photos/videos on the report. */
  attachmentCount?: number;
}

/** Signed and not unlocked → read-only (mirrors isIncidentLocked on the server). */
export function isReportLocked(r: Pick<IncidentReport, "signedAt" | "unlockedAt">): boolean {
  return !!r.signedAt && !r.unlockedAt;
}

const KIND_META: Record<IncidentKind, { label: string; chip: string }> = {
  accident: { label: INCIDENT_KIND_LABEL.accident, chip: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
  incident: { label: INCIDENT_KIND_LABEL.incident, chip: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  near_miss: { label: INCIDENT_KIND_LABEL.near_miss, chip: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200" },
};

async function errorText(res: Response, fallback: string): Promise<string> {
  return (await res.json().catch(() => ({}))).error ?? fallback;
}

/** The diary, newest first. */
export function useIncidentReports(enabled = true) {
  return useQuery<IncidentReport[]>({
    queryKey: INCIDENT_REPORTS_KEY,
    enabled,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/incidents`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load the diary");
      return res.json();
    },
  });
}

/** Start a report, auto-dated to now (optionally as a given type). */
export function useCreateIncidentReport(onCreated: (row: IncidentReport) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (kind?: IncidentKind) => {
      const res = await fetch(`${BASE}/api/incidents`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind ? { kind } : {}),
      });
      if (!res.ok) throw new Error(await errorText(res, "Failed to create"));
      return res.json() as Promise<IncidentReport>;
    },
    onSuccess: (row) => {
      void queryClient.invalidateQueries({ queryKey: INCIDENT_REPORTS_KEY });
      onCreated(row);
    },
    onError: (e) => toast({ title: "Couldn't start a report", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });
}

const STEPS: Array<{ key: "productionStopped" | "foodDiscarded" | "riskAssessmentDone" | "areaCleaned"; label: string; hint: string; icon: typeof Ban }> = [
  { key: "productionStopped", label: "Production stopped in the area", hint: "Nothing made or handled there until it's safe", icon: Ban },
  { key: "foodDiscarded", label: "At-risk food thrown away", hint: "Anything exposed or nearby, disposed and noted below", icon: Utensils },
  { key: "riskAssessmentDone", label: "Risk assessment carried out", hint: "What could have been contaminated, and how far", icon: ClipboardCheck },
  { key: "areaCleaned", label: "Area cleaned & sanitised", hint: "Full clean-down before production resumes", icon: Sparkles },
];

export function IncidentDiaryTab() {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<number | null>(null);

  const { data: reports = [], isLoading } = useIncidentReports();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: INCIDENT_REPORTS_KEY });

  const createMutation = useCreateIncidentReport((row) => {
    setOpenId(row.id);
    toast({ title: "Report started", description: "Auto-dated to now — fill it in below, everything saves as you go." });
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
          onClick={() => createMutation.mutate(undefined)}
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
            {report.attachmentCount ? ` · ${report.attachmentCount} photo${report.attachmentCount === 1 ? "" : "s"}` : ""}
            {report.unlockedAt
              ? ` · Unlocked by ${report.unlockedByName ?? "a manager"} — needs signing again`
              : report.signedAt && report.signedByName
                ? ` · Signed${report.signedVersion > 1 ? ` (v${report.signedVersion})` : ""} by ${report.signedByName}, ${format(new Date(report.signedAt), "d MMM HH:mm")}`
                : " · not signed yet"}
          </p>
        </div>
        {isReportLocked(report) && <Lock className="w-4 h-4 text-emerald-600 flex-shrink-0" aria-label="Signed and locked" />}
        {open ? <ChevronUp className="w-5 h-5 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-5 h-5 text-muted-foreground flex-shrink-0" />}
      </button>
      {open && <div className="border-t border-border p-4"><IncidentReportDetail report={report} onChanged={onChanged} /></div>}
    </div>
  );
}

/**
 * One report's form: fields (autosave), photos, containment steps, the
 * signature and lock, and the History. Used inside the diary card and in
 * the quick-actions pop-up.
 */
export function IncidentReportDetail({ report, onChanged, onDeleted }: {
  report: IncidentReport;
  onChanged: () => void;
  /** After "Delete draft" succeeds (the pop-up closes itself). */
  onDeleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const locked = isReportLocked(report);
  const refreshAll = () => {
    onChanged();
    void queryClient.invalidateQueries({ queryKey: historyKey(report.id) });
  };

  const patch = async (body: Record<string, unknown>) => {
    const res = await fetch(`${BASE}/api/incidents/${report.id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const msg = await errorText(res, "Failed to save");
      // 409 = signed and locked (maybe by someone else just now): refresh
      // so the form shows the lock.
      if (res.status === 409) onChanged();
      throw new Error(msg);
    }
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
    if (!res.ok) throw new Error(await errorText(res, "Failed to sign"));
    refreshAll();
    toast({ title: "Signed and locked", description: "Your name and the time are on the report. It can't be changed now unless a manager unlocks it." });
  });

  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockReason, setUnlockReason] = useState("");
  const unlock = () => action("unlock", async () => {
    const res = await fetch(`${BASE}/api/incidents/${report.id}/unlock`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: unlockReason.trim() }),
    });
    if (!res.ok) throw new Error(await errorText(res, "Failed to unlock"));
    setUnlockOpen(false);
    setUnlockReason("");
    refreshAll();
    toast({ title: "Unlocked", description: "Update the report, then sign it again. The signed version is kept in its History." });
  });

  const closeOrReopen = (reopen: boolean) => action("close", async () => {
    const res = await fetch(`${BASE}/api/incidents/${report.id}/close`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reopen }),
    });
    if (!res.ok) throw new Error(await errorText(res, "Failed"));
    onChanged();
  });

  const remove = () => action("delete", async () => {
    if (!confirm("Delete this unsigned draft report?")) return;
    const res = await fetch(`${BASE}/api/incidents/${report.id}`, { method: "DELETE", credentials: "include" });
    if (!res.ok) throw new Error(await errorText(res, "Failed to delete"));
    onChanged();
    onDeleted?.();
  });

  // datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
  const occurredLocal = (() => {
    const d = new Date(report.occurredAt);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();

  const inputCls = "mt-1 block w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm font-normal normal-case disabled:opacity-100 disabled:bg-secondary/30 disabled:cursor-not-allowed";

  return (
    <div className="space-y-5">
      {/* Lock state — the first thing on a signed or unlocked report. */}
      {locked && report.signedAt && (
        <div className="rounded-xl border-2 border-emerald-500/60 bg-emerald-500/10 p-4 space-y-3">
          <div className="flex items-start gap-3 flex-wrap justify-between">
            <p className="text-sm flex items-start gap-2 min-w-0">
              <Lock className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <span>
                <b>Signed and locked</b>{report.signedVersion > 1 ? ` (version ${report.signedVersion})` : ""} — signed by{" "}
                <b>{report.signedByName ?? "a manager"}</b> on {format(new Date(report.signedAt), "d MMM yyyy 'at' HH:mm")}.
                <span className="block text-muted-foreground">The wording can't be changed. Photos can still be added — they're marked "added after signing".</span>
              </span>
            </p>
            {!unlockOpen && (
              <button onClick={() => setUnlockOpen(true)} disabled={busyAction !== null}
                className="min-h-11 px-4 py-2 rounded-lg border-2 border-border bg-card text-sm font-semibold hover:bg-secondary/40 inline-flex items-center gap-1.5">
                <Unlock className="w-4 h-4" /> Unlock to update
              </button>
            )}
          </div>
          {unlockOpen && (
            <div className="rounded-lg bg-card border border-border p-3 space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">
                Why does it need updating?
                <textarea rows={2} autoFocus value={unlockReason} onChange={e => setUnlockReason(e.target.value)}
                  placeholder="e.g. Adding the hospital visit / supplier's reply"
                  className="mt-1 block w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm font-normal normal-case" />
              </label>
              <p className="text-xs text-muted-foreground">Your name, the time and this reason go in the report's History, with the signed version kept exactly as it was. It must be signed again afterwards.</p>
              <div className="flex gap-2 flex-wrap">
                <button onClick={unlock} disabled={!unlockReason.trim() || busyAction !== null}
                  className="min-h-11 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-bold hover:bg-amber-700 disabled:opacity-50 inline-flex items-center gap-1.5">
                  {busyAction === "unlock" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlock className="w-4 h-4" />} Unlock
                </button>
                <button onClick={() => { setUnlockOpen(false); setUnlockReason(""); }}
                  className="min-h-11 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-secondary/40">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {report.unlockedAt && (
        <div className="rounded-xl border-2 border-amber-500/70 bg-amber-500/10 p-4">
          <p className="text-sm flex items-start gap-2">
            <Unlock className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <span>
              <b>Unlocked by {report.unlockedByName ?? "a manager"} on {format(new Date(report.unlockedAt), "d MMM yyyy 'at' HH:mm")}</b>
              {report.unlockReason ? <> — {report.unlockReason}</> : null} — <b>needs signing again</b>.
            </span>
          </p>
        </div>
      )}

      {/* When / what kind / where */}
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          When it happened
          <input
            key={`${occurredLocal}-${locked}`}
            type="datetime-local"
            defaultValue={occurredLocal}
            disabled={locked}
            onBlur={e => {
              if (e.target.value && e.target.value !== occurredLocal) {
                void action("when", () => patch({ occurredAt: new Date(e.target.value).toISOString() }));
              }
            }}
            className={inputCls}
          />
        </label>
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Type
          <select
            key={`${report.kind}-${locked}`}
            defaultValue={report.kind}
            disabled={locked}
            onChange={e => void action("kind", () => patch({ kind: e.target.value }))}
            className={inputCls}
          >
            {INCIDENT_KIND_OPTIONS.map(o => <option key={o.kind} value={o.kind}>{o.label}</option>)}
          </select>
        </label>
        <AutosaveField label="Where in the factory" value={report.location ?? ""} readOnly={locked} placeholder="e.g. Oven area" onSave={v => patch({ location: v || null })} />
      </div>

      <AutosaveField label="What happened (one line)" value={report.title} readOnly={locked} placeholder="e.g. Tempered glass oven door shattered onto the floor" onSave={v => patch({ title: v })} />
      <AutosaveField label="Full description" value={report.description ?? ""} readOnly={locked} multiline placeholder="What happened, how, and what was affected…" onSave={v => patch({ description: v || null })} />

      {/* Photos & videos — HACCP evidence (Graeme, 2026-10-13: a foreign
          object report needed its photo). Can be added after signing; those
          are marked as such and the signed report itself is untouched. */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Photos &amp; videos</p>
        <IncidentAttachments incidentId={report.id} onChanged={onChanged} />
      </div>

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
                disabled={locked || busyAction === s.key}
                className={cn(
                  "text-left rounded-xl border-2 p-3 flex items-start gap-3 transition-colors disabled:cursor-not-allowed",
                  on ? "border-emerald-500/70 bg-emerald-500/10" : "border-border",
                  !locked && !on && "hover:bg-secondary/30",
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
        <AutosaveField label="People involved / witnesses" value={report.peopleInvolved ?? ""} readOnly={locked} multiline placeholder="Who was there, who dealt with it" onSave={v => patch({ peopleInvolved: v || null })} />
        <AutosaveField label="Injuries & first aid" value={report.injuries ?? ""} readOnly={locked} multiline placeholder="None / what was treated and by whom" onSave={v => patch({ injuries: v || null })} />
        <AutosaveField label="Food safety impact" value={report.foodSafetyImpact ?? ""} readOnly={locked} multiline placeholder="What food was at risk, what was thrown away" onSave={v => patch({ foodSafetyImpact: v || null })} />
        <AutosaveField label="Immediate actions taken" value={report.immediateActions ?? ""} readOnly={locked} multiline placeholder="Stopped production, cordoned area, initial clean-up…" onSave={v => patch({ immediateActions: v || null })} />
      </div>
      <AutosaveField label="Corrective actions — stop it happening again" value={report.correctiveActions ?? ""} readOnly={locked} multiline placeholder="Full clean-down after production, door replacement, checks added…" onSave={v => patch({ correctiveActions: v || null })} />

      {/* Signature + lifecycle */}
      <div className="rounded-xl border border-border bg-secondary/20 p-4 flex items-center justify-between gap-3 flex-wrap">
        {locked && report.signedAt ? (
          <p className="text-sm inline-flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            Signed by <b>{report.signedByName}</b> on {format(new Date(report.signedAt), "d MMM yyyy 'at' HH:mm")}
          </p>
        ) : report.unlockedAt ? (
          <p className="text-sm text-muted-foreground inline-flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" /> Unlocked — sign again once the update is right.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground inline-flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" /> Not signed yet — sign once the details are right. Signing locks it.
          </p>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {!report.signedAt && !report.attachmentCount && (
            <button onClick={remove} disabled={busyAction !== null}
              className="min-h-11 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 inline-flex items-center gap-1.5">
              <Trash2 className="w-4 h-4" /> Delete draft
            </button>
          )}
          {!locked && (
            <button onClick={sign} disabled={busyAction !== null}
              className="min-h-11 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 disabled:opacity-60 inline-flex items-center gap-1.5">
              {busyAction === "sign" ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenLine className="w-4 h-4" />}
              {report.unlockedAt ? "Sign again" : "Sign this report"}
            </button>
          )}
          {report.status === "open" ? (
            <button onClick={() => closeOrReopen(false)} disabled={busyAction !== null}
              className="min-h-11 px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-secondary/40 disabled:opacity-60">
              Close report
            </button>
          ) : (
            <button onClick={() => closeOrReopen(true)} disabled={busyAction !== null}
              className="min-h-11 px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-secondary/40 disabled:opacity-60">
              Reopen
            </button>
          )}
        </div>
      </div>

      {(report.signedVersion > 0 || report.unlockedAt) && <IncidentHistory incidentId={report.id} />}
    </div>
  );
}

interface FieldChange {
  key: string;
  label: string;
  type: "kind" | "datetime" | "text" | "bool";
  before: string | boolean | null;
  after: string | boolean | null;
}

interface HistoryEntry {
  id: number;
  event: "signed" | "unlocked";
  version: number;
  actorName: string | null;
  reason: string | null;
  at: string;
  changes: FieldChange[] | null;
}

function changeValue(c: FieldChange, v: string | boolean | null): string {
  if (c.type === "bool") return v ? "Yes" : "No";
  if (v == null || v === "") return "(blank)";
  if (c.type === "kind") return INCIDENT_KIND_LABEL[v as IncidentKind] ?? String(v);
  if (c.type === "datetime") {
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? String(v) : format(d, "d MMM yyyy, HH:mm");
  }
  return String(v);
}

/** Signed v1 → unlocked (who/when/why) → signed v2 (what changed) … */
function IncidentHistory({ incidentId }: { incidentId: number }) {
  const { data = [], isLoading, isError } = useQuery<HistoryEntry[]>({
    queryKey: historyKey(incidentId),
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/incidents/${incidentId}/history`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load the history");
      return res.json();
    },
  });
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 inline-flex items-center gap-1.5">
        <History className="w-3.5 h-3.5" /> History
      </p>
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      ) : isError ? (
        <p className="text-sm text-destructive">Couldn't load the history.</p>
      ) : data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet.</p>
      ) : (
        <ol className="space-y-2">
          {data.map(e => (
            <li key={e.id} className={cn(
              "rounded-xl border-2 p-3",
              e.event === "signed" ? "border-emerald-500/40" : "border-amber-500/50",
            )}>
              <p className="text-sm">
                {e.event === "signed" ? (
                  <><PenLine className="w-4 h-4 inline -mt-0.5 mr-1 text-emerald-600" /><b>Signed — version {e.version}</b> by {e.actorName ?? "someone"}</>
                ) : (
                  <><Unlock className="w-4 h-4 inline -mt-0.5 mr-1 text-amber-600" /><b>Unlocked</b> by {e.actorName ?? "someone"}</>
                )}
                <span className="text-muted-foreground"> · {e.at ? format(new Date(e.at), "d MMM yyyy 'at' HH:mm") : ""}</span>
              </p>
              {e.event === "unlocked" && e.reason && <p className="text-sm text-muted-foreground mt-0.5">Why: {e.reason}</p>}
              {e.changes && e.changes.length === 0 && (
                <p className="text-sm text-muted-foreground mt-1">No changes from version {e.version - 1}.</p>
              )}
              {e.changes && e.changes.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {e.changes.map(c => (
                    <li key={c.key} className="text-sm rounded-lg bg-secondary/30 px-3 py-2">
                      <span className="font-semibold">{c.label}</span>
                      <span className="block text-muted-foreground line-through decoration-1 whitespace-pre-wrap break-words">{changeValue(c, c.before)}</span>
                      <span className="block whitespace-pre-wrap break-words">{changeValue(c, c.after)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Autosave-on-blur text field with a visible saved tick. */
function AutosaveField({ label, value, placeholder, multiline = false, readOnly = false, onSave }: {
  label: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  /** Signed and locked: shown, selectable, not editable. */
  readOnly?: boolean;
  onSave: (value: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  useEffect(() => { setDraft(value); }, [value, readOnly]);

  const save = async () => {
    if (readOnly || draft === value) return;
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

  const cls = cn(
    "mt-1 block w-full px-3 py-2.5 border border-border rounded-lg text-sm font-normal normal-case focus:outline-none focus:ring-2 focus:ring-primary/30",
    readOnly ? "bg-secondary/30 cursor-default" : "bg-background",
  );
  return (
    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block">
      <span className="inline-flex items-center gap-1.5">
        {label}
        {state === "saving" && <Loader2 className="w-3 h-3 animate-spin text-primary" />}
        {state === "saved" && <span className="text-emerald-600 normal-case font-medium inline-flex items-center gap-0.5"><Check className="w-3 h-3" /> saved</span>}
        {state === "error" && <span className="text-destructive normal-case font-medium">not saved</span>}
      </span>
      {multiline ? (
        <textarea rows={3} value={draft} readOnly={readOnly} placeholder={readOnly ? "" : placeholder} onChange={e => setDraft(e.target.value)} onBlur={save} className={cls} />
      ) : (
        <input value={draft} readOnly={readOnly} placeholder={readOnly ? "" : placeholder} onChange={e => setDraft(e.target.value)} onBlur={save} className={cls} />
      )}
    </label>
  );
}
