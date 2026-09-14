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
  managerName: string | null; colleagueSignedAt: string | null; managerSignedAt: string | null;
  status: string;
}

const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const fmtRange = (s: string, e: string | null) => (!e || e === s) ? fmtDay(s) : `${fmtDay(s)} – ${fmtDay(e)}`;

export function SickLeaveModal({ userId, userName, onClose }: { userId: number; userName: string; onClose: () => void }) {
  const [data, setData] = useState<{ forms: RtwForm[]; spells: SickSpell[] } | null>(null);
  const [denied, setDenied] = useState(false);
  const [detail, setDetail] = useState<RtwForm | null>(null);

  useEffect(() => {
    fetch(`${BASE}/api/return-to-work/user/${userId}`, { credentials: "include" })
      .then(async r => {
        if (r.status === 403) { setDenied(true); return; }
        if (!r.ok) throw new Error();
        setData(await r.json());
      })
      .catch(() => setDenied(true));
  }, [userId]);

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
                return (
                  <button
                    key={spell.start}
                    onClick={() => spell.formId != null && openDetail(spell.formId)}
                    disabled={spell.formId == null}
                    className={cn(
                      "w-full text-left rounded-xl border-2 p-3.5 flex items-center gap-3 transition-colors",
                      spell.formId != null ? "border-border bg-background hover:border-primary/50" : "border-dashed border-border bg-secondary/20",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{fmtRange(spell.start, spell.end)} · {spell.days} day{spell.days !== 1 ? "s" : ""}</p>
                      <p className="text-sm text-muted-foreground truncate">
                        {form?.reasonCategory
                          ? `${form.reasonCategory}${form.status !== "complete" ? " (draft)" : ""}`
                          : spell.formId != null ? "Report started — no reason recorded yet" : "No return-to-work report yet"}
                      </p>
                    </div>
                    {spell.formId != null && <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />}
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
                    <p className="text-sm text-muted-foreground truncate">{f.reasonCategory ?? "Report"}{f.status !== "complete" ? " (draft)" : ""}</p>
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
