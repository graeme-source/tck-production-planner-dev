/**
 * "There's already a plan for this day" (Graeme, 2026-10-15). A double tap
 * left two identical Friday plans and doubled every prep and ordering figure.
 * Creating a plan for a date that already has one now asks what you meant:
 *   - Open the existing plan (the usual answer)
 *   - Replace it with this one — only a DRAFT can be replaced; an active plan
 *     may already have work recorded against it
 *   - Create a second plan anyway — for a genuine second run (e.g. a separate
 *     mac cheese or prep & pack day)
 * Closable (X / Esc / outside), viewport-fit, big buttons.
 */
import { AlertTriangle, CopyPlus, ExternalLink, Replace, X } from "lucide-react";
import { format, parseISO } from "date-fns";

export interface ClashPlan { id: number; name: string; status: string; planDate: string }

export function PlanDateClashDialog({ open, planDate, plans, saving, onOpen, onReplace, onCreateAnother, onClose }: {
  open: boolean;
  planDate: string;
  plans: ClashPlan[];
  saving?: boolean;
  onOpen: (planId: number) => void;
  onReplace: (planId: number) => void;
  onCreateAnother: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(planDate) ? format(parseISO(planDate), "EEEE d MMM yyyy") : planDate;
  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-3" onClick={onClose}
      onKeyDown={e => { if (e.key === "Escape") onClose(); }} role="dialog" aria-modal="true" aria-label="A plan already exists for this day">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[92dvh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 px-5 py-4 border-b border-border">
          <AlertTriangle className="w-6 h-6 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-bold text-xl leading-tight">There's already a plan for {day}</h2>
            <p className="text-sm text-muted-foreground mt-1">Two plans for the same day double every prep and ordering figure. What did you mean to do?</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0"><X className="w-6 h-6" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {plans.map(p => (
            <div key={p.id} className="rounded-2xl border-2 border-border p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold flex-1 min-w-0 truncate">{p.name}</p>
                <span className={p.status === "draft"
                  ? "px-2.5 py-0.5 rounded-full text-xs font-bold bg-secondary text-muted-foreground"
                  : "px-2.5 py-0.5 rounded-full text-xs font-bold bg-primary/15 text-primary"}>
                  {p.status === "draft" ? "Draft" : p.status === "active" ? "Active" : p.status}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button type="button" disabled={saving} onClick={() => onOpen(p.id)}
                  className="h-12 rounded-xl bg-primary text-primary-foreground font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                  <ExternalLink className="w-5 h-5" /> Open this plan
                </button>
                {p.status === "draft" ? (
                  <button type="button" disabled={saving} onClick={() => onReplace(p.id)}
                    className="h-12 rounded-xl border-2 border-amber-500 text-amber-800 dark:text-amber-200 font-bold flex items-center justify-center gap-2 hover:bg-amber-50 dark:hover:bg-amber-950/30 disabled:opacity-50">
                    <Replace className="w-5 h-5" /> Replace it with this one
                  </button>
                ) : (
                  <p className="text-xs text-muted-foreground self-center">It's {p.status} — open it to change it, so nothing recorded on it is lost.</p>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="p-5 pt-0 flex flex-col sm:flex-row gap-2">
          <button type="button" onClick={onClose} className="flex-1 h-12 rounded-xl border-2 border-border font-semibold hover:bg-secondary/60">Go back</button>
          <button type="button" disabled={saving} onClick={onCreateAnother}
            className="flex-1 h-12 rounded-xl border-2 border-red-300 text-red-700 dark:text-red-300 font-semibold flex items-center justify-center gap-2 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50">
            <CopyPlus className="w-5 h-5" /> Create a second plan anyway
          </button>
        </div>
      </div>
    </div>
  );
}
