/**
 * Sick-leave drill-down for the Employee Records report (Graeme,
 * 2026-09-14): click a sick number → every INSTANCE for that person (dates,
 * length, reason from the return-to-work form when one exists) → click an
 * instance to read the full report. Privacy is enforced server-side: only
 * the colleague and the named RTW managers get content — anyone else gets
 * the door held politely shut.
 * Closable + viewport-fit per the standing modal rule.
 */
import { useEffect, useState } from "react";
import { X, Loader2, HeartPulse, ChevronRight, ChevronLeft, Lock, PenLine, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SickSpell { start: string; end: string; days: number; returned: boolean; formId: number | null; formStatus: string | null }
interface RtwForm {
  id: number; userId: number; userName: string | null;
  absenceStart: string; absenceEnd: string | null; returnDate: string | null;
  reasonCategory: string | null; reasonDetails: string | null; supportNotes: string | null;
  doctorSeen: boolean | null; workRelated: boolean | null;
  managerName: string | null; colleagueSignedAt: string | null; managerSignedAt: string | null;
  status: string;
}

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

export function SickLeaveModal({ userId, userName, fromDate, onClose }: { userId: number; userName: string; fromDate?: string; onClose: () => void }) {
  const [data, setData] = useState<{ forms: RtwForm[]; spells: SickSpell[] } | null>(null);
  const [denied, setDenied] = useState(false);
  const [detail, setDetail] = useState<RtwForm | null>(null);

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
              {detail ? fmtRange(detail.absenceStart, detail.absenceEnd) : `Sick leave — ${userName}`}
            </h2>
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Lock className="w-3 h-3" /> Private — colleague, Graeme and Lorna only</p>
          </div>
          {detail && (
            <button onClick={() => setDetail(null)} className="p-2 rounded-lg hover:bg-secondary" aria-label="Back to instances">
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
              Return-to-work records are private — only the colleague themselves, Graeme and Lorna can read them.
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
          ) : data.spells.length === 0 && data.forms.length === 0 ? (
            <p className="text-muted-foreground text-sm">No sick leave in the last few months, and no reports on file.</p>
          ) : (
            <>
              {data.spells.map(spell => {
                const form = spell.formId != null ? formsById.get(spell.formId) : undefined;
                if (spell.formId == null) {
                  return (
                    <div key={spell.start} className="w-full rounded-xl border-2 border-dashed border-border bg-secondary/20 p-3.5">
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">{fmtRange(spell.start, spell.end)} · {spell.days} day{spell.days !== 1 ? "s" : ""}</p>
                          <p className="text-sm text-muted-foreground truncate">No return-to-work report yet</p>
                        </div>
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
                      {/* The note rides along so Graeme can scan for a
                          recurring illness without opening each report. */}
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {form?.reasonCategory
                          ? `${form.reasonCategory}${form.reasonDetails ? ` — ${form.reasonDetails}` : ""}${form.status !== "complete" ? " (draft)" : ""}`
                          : "Report started — no reason recorded yet"}
                      </p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </button>
                );
              })}
              {/* Forms whose dates fall outside the detection window (e.g.
                  historical ones Graeme back-fills) still deserve a row. */}
              {data.forms.filter(f => !data.spells.some(s => s.formId === f.id)).map(f => (
                <button key={`f${f.id}`} onClick={() => openDetail(f.id)}
                  className="w-full text-left rounded-xl border-2 border-border bg-background p-3.5 flex items-center gap-3 hover:border-primary/50 transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{fmtRange(f.absenceStart, f.absenceEnd)}</p>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {f.reasonCategory ?? "Report"}{f.reasonDetails ? ` — ${f.reasonDetails}` : ""}{f.status !== "complete" ? " (draft)" : ""}
                    </p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                </button>
              ))}
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
