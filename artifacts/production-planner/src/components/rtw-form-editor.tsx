/**
 * The return-to-work form itself — fill in together, autosave with a visible
 * save state, attach fit notes and letters, sign together. Shared by the
 * colleague's own /return-to-work page and each person's record in People
 * (extracted 2026-09-25 so there is ONE form, not two).
 *
 * Covers any absence, not just sickness: the form records the kind of
 * absence (Planday's type for a detected spell, or the type picked when a
 * manager records one Planday doesn't show). Private to the colleague and
 * people with People access — the server enforces it.
 */
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle2, ChevronLeft, FileText, Lock, LockOpen, Paperclip, PenLine, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { rtwFieldsLocked, rtwCanOfferAmend } from "@/lib/rtw-edit-rules";
import { RTW_REASONS, absencePhrase, absenceTypeChoices } from "@/lib/rtw-wording";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface RtwForm {
  id: number;
  userId: number;
  userName: string | null;
  absenceStart: string;
  absenceEnd: string | null;
  /** Kind of absence (migration 0127); null on older forms, all sickness. */
  absenceType: string | null;
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

export function fmtRange(start: string, end: string | null) {
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

interface RtwAttachment {
  id: number;
  fileName: string | null;
  mime: string;
  uploadedByName: string | null;
  uploadedByUserId: number | null;
  createdAt: string;
}

/** Documentation filed against the form — fit notes, appointment letters,
 *  photos. A draft accepts uploads from the colleague and the RTW managers;
 *  a signed form accepts them from the RTW managers only (server-enforced,
 *  the buttons just follow). */
function FormAttachments({ formId, formStatus, isRtwManager }: { formId: number; formStatus: string; isRtwManager: boolean }) {
  const queryClient = useQueryClient();
  const { state: authState } = useAuth();
  const myUserId = authState.status === "authenticated" ? authState.user.id : null;
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const key = ["rtw-attachments", formId];
  const { data: attachments = [] } = useQuery<RtwAttachment[]>({
    queryKey: key,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/return-to-work/${formId}/attachments`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load documents");
      return r.json();
    },
  });

  const canAdd = isRtwManager || formStatus !== "complete";
  const canDelete = (a: RtwAttachment) =>
    isRtwManager || (formStatus !== "complete" && a.uploadedByUserId != null && a.uploadedByUserId === myUserId);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch(`${BASE}/api/return-to-work/${formId}/attachments`, {
        method: "POST", credentials: "include", body: form,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Upload failed");
      toast({ title: "Document filed", description: "It's on the form — same privacy as the form itself." });
      void queryClient.invalidateQueries({ queryKey: key });
    } catch (err) {
      toast({ title: "Couldn't file it", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const remove = async (id: number) => {
    const r = await fetch(`${BASE}/api/return-to-work/attachments/${id}`, { method: "DELETE", credentials: "include" });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      toast({ title: "Couldn't remove it", description: d.error ?? "Try again", variant: "destructive" });
      return;
    }
    setConfirmDeleteId(null);
    void queryClient.invalidateQueries({ queryKey: key });
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-semibold flex items-center gap-1.5">
        <Paperclip className="w-4 h-4" /> Documents — fit notes, appointment letters
      </label>

      {attachments.map(a => (
        <div key={a.id} className="rounded-xl border-2 border-border bg-background px-3 py-2.5 flex items-center gap-3">
          <FileText className="w-5 h-5 text-muted-foreground shrink-0" />
          <a
            href={`${BASE}/api/return-to-work/attachments/${a.id}`}
            target="_blank"
            rel="noreferrer"
            className="flex-1 min-w-0 truncate text-base font-semibold underline underline-offset-2 hover:text-primary"
          >
            {a.fileName || (a.mime === "application/pdf" ? "Document.pdf" : "Photo")}
          </a>
          <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
            {a.uploadedByName ?? "Someone"} · {fmtRange(a.createdAt.slice(0, 10), null)}
          </span>
          {canDelete(a) && (confirmDeleteId === a.id ? (
            <span className="flex items-center gap-1.5 shrink-0">
              <button onClick={() => remove(a.id)} className="px-2 py-1 rounded-lg bg-destructive text-destructive-foreground text-xs font-bold">Delete</button>
              <button onClick={() => setConfirmDeleteId(null)} className="px-2 py-1 rounded-lg border border-border text-xs font-bold"><X className="w-3.5 h-3.5" /></button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmDeleteId(a.id)}
              className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              title="Remove this document"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          ))}
        </div>
      ))}

      {attachments.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing filed yet.</p>
      )}

      {canAdd && (
        <>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            className="w-full h-12 rounded-xl border-2 border-dashed border-border text-base font-bold flex items-center justify-center gap-2 hover:bg-secondary/50 text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
            {uploading ? "Filing…" : "Add a document (PDF or photo)"}
          </button>
        </>
      )}
    </div>
  );
}

export function FormEditor({ form, isRtwManager, onDone, onBack }: { form: RtwForm; isRtwManager: boolean; onDone: () => void; onBack: () => void }) {
  const [f, setF] = useState(form);
  const { state: saveState, save } = useAutosave(form.id);
  const [signing, setSigning] = useState(false);
  // A signed form is a record and stays locked — but people with People access
  // can deliberately unlock it to add or correct something (the server has
  // always allowed their edits; the page used to lock them out too).
  const [amending, setAmending] = useState(false);
  const readOnly = rtwFieldsLocked({ status: f.status, isRtwManager, amending });

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
      toast({ title: "Return-to-work form signed", description: "Thanks — it's filed, private to them and people with People access." });
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
          {f.userName ?? "Return to work"} — {absencePhrase(f.absenceType)} {fmtRange(f.absenceStart, f.absenceEnd)}
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
        {rtwCanOfferAmend({ status: f.status, isRtwManager }) && !amending && (
          <button
            onClick={() => setAmending(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border-2 border-border text-sm font-bold hover:bg-secondary/50"
            title="Unlock this signed form to add or correct something — People access only"
          >
            <LockOpen className="w-4 h-4" /> Amend
          </button>
        )}
      </div>

      {amending && f.status === "complete" && (
        <div className="rounded-xl border-2 border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 flex items-center gap-3 flex-wrap">
          <PenLine className="w-5 h-5 text-amber-600 shrink-0" />
          <p className="flex-1 min-w-0 text-sm font-medium text-amber-900 dark:text-amber-200">
            Amending a signed form — changes save as you type. It stays signed.
          </p>
          <button
            onClick={() => setAmending(false)}
            className="px-3 py-1.5 rounded-xl bg-amber-600 text-white text-sm font-bold hover:bg-amber-700"
          >
            Done amending
          </button>
        </div>
      )}

      <div>
        <label className="text-sm font-semibold block mb-1">Type of absence</label>
        <select disabled={readOnly} value={f.absenceType ?? ""} onChange={e => set("absenceType", e.target.value || null, "absenceType")} className={inputCls}>
          <option value="">Sickness (not recorded)</option>
          {absenceTypeChoices(f.absenceType).map(t => <option key={t} value={t}>{t}</option>)}
        </select>
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
            {RTW_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
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
          placeholder="Who sat down with you" className={inputCls} />
      </div>

      <FormAttachments formId={f.id} formStatus={f.status} isRtwManager={isRtwManager} />

      {f.status !== "complete" && (
        <button onClick={sign} disabled={signing}
          className="w-full h-14 rounded-xl bg-primary text-primary-foreground font-bold text-lg flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50">
          {signing ? <Loader2 className="w-5 h-5 animate-spin" /> : <PenLine className="w-5 h-5" />} Sign & complete together
        </button>
      )}

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Lock className="w-3.5 h-3.5" /> Private — visible only to {f.userName ?? "you"} and people with People access.
      </p>
    </div>
  );
}

