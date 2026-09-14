/**
 * Attendance timeline for the Employee Records report (Graeme, 2026-09-14):
 * click a sick, instance or late number → ONE chronological history of the
 * person's sick-leave spells, lates and absences, clearly labelled and
 * filterable. Sick spells carry their return-to-work reason inline and open
 * the full report; bare spells offer the quick "Add reason" back-fill.
 * Privacy is enforced server-side: only the colleague and the named RTW
 * managers get content — anyone else gets the door held politely shut.
 * Closable + viewport-fit per the standing modal rule.
 */
import { useEffect, useState } from "react";
import { X, Loader2, HeartPulse, ChevronRight, ChevronLeft, Lock, PenLine, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SickSpell { start: string; end: string; days: number; returned: boolean; formId: number | null; formStatus: string | null }
interface AttendanceEvent { date: string; kind: "late" | "absence"; label: string }
interface RtwForm {
  id: number; userId: number; userName: string | null;
  absenceStart: string; absenceEnd: string | null; returnDate: string | null;
  reasonCategory: string | null; reasonDetails: string | null; supportNotes: string | null;
  doctorSeen: boolean | null; workRelated: boolean | null;
  managerName: string | null; colleagueSignedAt: string | null; managerSignedAt: string | null;
  status: string;
}

export type TimelineFilter = "all" | "sick" | "late" | "absence";

const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const fmtRange = (s: string, e: string | null) => (!e || e === s) ? fmtDay(s) : `${fmtDay(s)} – ${fmtDay(e)}`;

const REASONS = ["Illness", "Injury", "Medical appointment / procedure", "Stress or mental health", "Other"];

/** Historical back-fill (Graeme, 2026-09-14): just a reason against the
 *  dates — no full form. Creates a minimal record signed by the recorder. */
function QuickAddReason({ userId, spell, onSaved }: {
  userId: number;
  spell: SickSpell;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const created = await fetch(`${BASE}/api/return-to-work`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, absenceStart: spell.start, absenceEnd: spell.end }),
      }).then(r => r.json());
      if (!created.id) throw new Error(created.error ?? "Failed");
      await fetch(`${BASE}/api/return-to-work/${created.id}`, {
        method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reasonCategory: reason || null, reasonDetails: note.trim() || null }),
      });
      const done = await fetch(`${BASE}/api/return-to-work/${created.id}/complete`, { method: "POST", credentials: "include" });
      if (!done.ok) throw new Error((await done.json().catch(() => ({}))).error ?? "Failed to save");
      onSaved();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't save the reason");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button onClick={e => { e.stopPropagation(); setOpen(true); }}
        className="text-xs font-semibold text-primary hover:underline flex-shrink-0">
        Add reason
      </button>
    );
  }
  return (
    <div className="w-full mt-2 flex flex-col gap-2" onClick={e => e.stopPropagation()}>
      <select value={reason} onChange={e => setReason(e.target.value)}
        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm">
        <option value="">Reason…</option>
        {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Optional note"
        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
      <div className="flex gap-2">
        <button onClick={save} disabled={saving}
          className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold disabled:opacity-50 flex items-center gap-1.5">
          {saving && <Loader2 className="w-3 h-3 animate-spin" />} Save reason
        </button>
        <button onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground">Cancel</button>
      </div>
    </div>
  );
}

type TimelineItem =
  | { sortKey: string; kind: "sick"; spell: SickSpell }
  | { sortKey: string; kind: "sick-form"; form: RtwForm }
  | { sortKey: string; kind: "late" | "absence"; event: AttendanceEvent };

export function SickLeaveModal({ userId, userName, fromDate, initialFilter = "all", onClose }: {
  userId: number;
  userName: string;
  fromDate?: string;
  initialFilter?: TimelineFilter;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ forms: RtwForm[]; spells: SickSpell[]; events?: AttendanceEvent[] } | null>(null);
  const [denied, setDenied] = useState(false);
  const [detail, setDetail] = useState<RtwForm | null>(null);
  const [filter, setFilter] = useState<TimelineFilter>(initialFilter);

  const load = () =>
    fetch(`${BASE}/api/return-to-work/user/${userId}${fromDate ? `?from=${fromDate}` : ""}`, { credentials: "include" })
      .then(async r => {
        if (r.status === 403) { setDenied(true); return; }
        if (!r.ok) throw new Error();
        setData(await r.json());
      })
      .catch(() => setDenied(true));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userId]);

  const openDetail = async (formId: number) => {
    const r = await fetch(`${BASE}/api/return-to-work/form/${formId}`, { credentials: "include" });
    if (r.ok) setDetail(await r.json());
  };

  const formsById = new Map((data?.forms ?? []).map(f => [f.id, f]));
  const spellFormIds = new Set((data?.spells ?? []).map(s => s.formId).filter(Boolean));

  // One chronological ledger, newest first: sick spells, orphan forms
  // (dates outside the window, e.g. hand-recorded history), lates, absences.
  const items: TimelineItem[] = [
    ...(data?.spells ?? []).map(spell => ({ sortKey: spell.end, kind: "sick" as const, spell })),
    ...(data?.forms ?? []).filter(f => !spellFormIds.has(f.id))
      .map(form => ({ sortKey: form.absenceEnd ?? form.absenceStart, kind: "sick-form" as const, form })),
    ...(data?.events ?? []).map(event => ({ sortKey: event.date, kind: event.kind, event })),
  ].sort((a, b) => b.sortKey.localeCompare(a.sortKey));

  const counts = {
    sick: items.filter(i => i.kind === "sick" || i.kind === "sick-form").length,
    late: items.filter(i => i.kind === "late").length,
    absence: items.filter(i => i.kind === "absence").length,
  };
  const visible = items.filter(i =>
    filter === "all" ? true :
    filter === "sick" ? (i.kind === "sick" || i.kind === "sick-form") :
    i.kind === filter);

  const chip = (key: TimelineFilter, label: string, count?: number) => (
    <button key={key} onClick={() => setFilter(key)}
      className={cn(
        "px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-colors",
        filter === key ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground",
      )}>
      {label}{count != null ? ` ${count}` : ""}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 flex items-center justify-center p-3 md:p-8" onClick={onClose}>
      <div
        className="bg-card border-2 border-border rounded-2xl shadow-2xl w-full max-w-xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <div className="w-9 h-9 rounded-xl bg-rose-100 dark:bg-rose-950/40 flex items-center justify-center flex-shrink-0">
            <HeartPulse className="w-5 h-5 text-rose-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-bold text-lg leading-tight truncate">
              {detail ? fmtRange(detail.absenceStart, detail.absenceEnd) : `Attendance — ${userName}`}
            </h2>
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Lock className="w-3 h-3" /> Private — colleague, Graeme and Lorna only</p>
          </div>
          {detail && (
            <button onClick={() => setDetail(null)} className="p-2 rounded-lg hover:bg-secondary" aria-label="Back to timeline">
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {denied ? (
            <p className="text-muted-foreground text-sm">
              Attendance records here include return-to-work reports, which are private — only the colleague themselves, Graeme and Lorna can read them.
            </p>
          ) : detail ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-muted-foreground">Absence</p><p className="font-semibold">{fmtRange(detail.absenceStart, detail.absenceEnd)}</p></div>
                <div><p className="text-xs text-muted-foreground">Back at work</p><p className="font-semibold">{detail.returnDate ? fmtDay(detail.returnDate) : "—"}</p></div>
              </div>
              <div><p className="text-xs text-muted-foreground">Reason</p><p className="font-semibold">{detail.reasonCategory ?? "—"}</p></div>
              {detail.reasonDetails && <div><p className="text-xs text-muted-foreground">What happened</p><p className="whitespace-pre-wrap">{detail.reasonDetails}</p></div>}
              {(detail.doctorSeen != null || detail.workRelated != null) && (
                <div className="grid grid-cols-2 gap-3">
                  <div><p className="text-xs text-muted-foreground">Doctor / fit note</p><p className="font-semibold">{detail.doctorSeen == null ? "—" : detail.doctorSeen ? "Yes" : "No"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Work-related</p><p className="font-semibold">{detail.workRelated == null ? "—" : detail.workRelated ? "Yes" : "No"}</p></div>
                </div>
              )}
              {detail.supportNotes && <div><p className="text-xs text-muted-foreground">Support / adjustments</p><p className="whitespace-pre-wrap">{detail.supportNotes}</p></div>}
              <div className="flex items-center gap-2 pt-2 border-t border-border">
                {detail.status === "complete"
                  ? <span className="inline-flex items-center gap-1.5 text-emerald-600 font-semibold"><CheckCircle2 className="w-4 h-4" /> Signed{detail.managerName ? ` with ${detail.managerName}` : ""}</span>
                  : <span className="inline-flex items-center gap-1.5 text-amber-600 font-semibold"><PenLine className="w-4 h-4" /> Draft — not yet signed</span>}
              </div>
            </div>
          ) : data == null ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing on record in this date range — no sick leave, lates or absences.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {chip("all", "All", items.length)}
                {chip("sick", "Sick leave", counts.sick)}
                {chip("late", "Late", counts.late)}
                {chip("absence", "Absence", counts.absence)}
              </div>

              {visible.map((item, idx) => {
                if (item.kind === "late" || item.kind === "absence") {
                  const isLate = item.kind === "late";
                  return (
                    <div key={`${item.kind}-${item.event.date}-${idx}`}
                      className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 flex items-center gap-3">
                      {isLate
                        ? <Clock className="w-4 h-4 text-amber-600 flex-shrink-0" />
                        : <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />}
                      <p className="min-w-0 flex-1 text-sm"><span className="font-semibold">{fmtDay(item.event.date)}</span></p>
                      <span className={cn(
                        "text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0",
                        isLate ? "bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300"
                          : "bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300",
                      )}>
                        {item.event.label}
                      </span>
                    </div>
                  );
                }
                if (item.kind === "sick-form") {
                  const f = item.form;
                  return (
                    <button key={`f${f.id}`} onClick={() => openDetail(f.id)}
                      className="w-full text-left rounded-xl border-2 border-border bg-background p-3.5 flex items-center gap-3 hover:border-primary/50 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{fmtRange(f.absenceStart, f.absenceEnd)}</p>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {f.reasonCategory ?? "Report"}{f.reasonDetails ? ` — ${f.reasonDetails}` : ""}{f.status !== "complete" ? " (draft)" : ""}
                        </p>
                      </div>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 flex-shrink-0">Sick leave</span>
                      <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    </button>
                  );
                }
                if (item.kind !== "sick") return null;
                const spell = item.spell;
                const form = spell.formId != null ? formsById.get(spell.formId) : undefined;
                if (spell.formId == null) {
                  return (
                    <div key={spell.start} className="w-full rounded-xl border-2 border-dashed border-border bg-secondary/20 p-3.5">
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">{fmtRange(spell.start, spell.end)} · {spell.days} day{spell.days !== 1 ? "s" : ""}</p>
                          <p className="text-sm text-muted-foreground truncate">No return-to-work report yet</p>
                        </div>
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 flex-shrink-0">Sick leave</span>
                        <QuickAddReason userId={userId} spell={spell} onSaved={() => void load()} />
                      </div>
                    </div>
                  );
                }
                return (
                  <button
                    key={spell.start}
                    onClick={() => openDetail(spell.formId!)}
                    className="w-full text-left rounded-xl border-2 border-border bg-background p-3.5 flex items-center gap-3 transition-colors hover:border-primary/50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{fmtRange(spell.start, spell.end)} · {spell.days} day{spell.days !== 1 ? "s" : ""}</p>
                      {/* The note rides along so a scan reads the actual
                          reasons, not just the category. */}
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {form?.reasonCategory
                          ? `${form.reasonCategory}${form.reasonDetails ? ` — ${form.reasonDetails}` : ""}${form.status !== "complete" ? " (draft)" : ""}`
                          : "Report started — no reason recorded yet"}
                      </p>
                    </div>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 flex-shrink-0">Sick leave</span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                );
              })}
              <a href={`${BASE}/return-to-work?user=${userId}`}
                className="block text-center text-sm font-semibold text-primary hover:underline pt-1">
                Open {userName.split(" ")[0]}'s return-to-work page →
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
