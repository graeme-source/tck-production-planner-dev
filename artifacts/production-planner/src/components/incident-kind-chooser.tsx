/**
 * "Is it an accident or an incident?" — the two big cards and the "Not
 * sure?" rule (Graeme, 2026-10-13). Objective B. One component, used by the
 * quick-actions pop-up (report-incident-modal.tsx) and the diary's own
 * "New report" button (incident-diary.tsx). Wording: lib/incident-kinds.ts.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Bandage, ChevronDown, ChevronUp, HelpCircle, Loader2, ShieldAlert, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PinnedBody } from "@/components/ui/pinned-save-bar";
import {
  INCIDENT_CHOICES, INCIDENT_CHOOSER_QUESTION, INCIDENT_NOT_SURE_NOTE, INCIDENT_NOT_SURE_RULE, INCIDENT_NOT_SURE_TITLE,
  type IncidentChoice, type IncidentKind,
} from "@/lib/incident-kinds";

const CARD_STYLE: Record<IncidentChoice, { tone: string; icon: typeof Bandage }> = {
  accident: { tone: "border-red-500/70 hover:bg-red-500/10", icon: Bandage },
  incident: { tone: "border-amber-500/70 hover:bg-amber-500/10", icon: TriangleAlert },
};

/** The cards + "Not sure?". `busyKind` shows a spinner on the card whose report is being started. */
export function IncidentKindChooser({ onChoose, busyKind, disabled = false }: {
  onChoose: (kind: IncidentKind) => void;
  busyKind?: IncidentKind | null;
  disabled?: boolean;
}) {
  const [notSureOpen, setNotSureOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {INCIDENT_CHOICES.map(c => {
          const style = CARD_STYLE[c.choice];
          const Icon = style.icon;
          const busy = busyKind === c.kind;
          return (
            <button
              key={c.choice}
              type="button"
              onClick={() => onChoose(c.kind)}
              disabled={disabled}
              className={cn("text-left rounded-3xl border-2 bg-card p-5 min-h-[180px] flex flex-col gap-3 transition-colors disabled:opacity-60", style.tone)}
            >
              <span className="flex items-center gap-3">
                {busy ? <Loader2 className="w-8 h-8 animate-spin shrink-0" /> : <Icon className="w-8 h-8 shrink-0" />}
                <span className="text-2xl font-bold">{c.title}</span>
              </span>
              <span className="text-base">{c.meaning}</span>
              <span className="text-sm text-muted-foreground">
                <span className="font-semibold">For example:</span>
                <span className="block">“{c.examples[0]}”</span>
                <span className="block">“{c.examples[1]}”</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl border border-border bg-secondary/20">
        <button
          type="button"
          onClick={() => setNotSureOpen(v => !v)}
          aria-expanded={notSureOpen}
          className="w-full min-h-12 px-4 py-3 flex items-center justify-between gap-3 text-left text-base font-semibold"
        >
          <span className="inline-flex items-center gap-2"><HelpCircle className="w-5 h-5 text-muted-foreground" /> {INCIDENT_NOT_SURE_TITLE}</span>
          {notSureOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
        {notSureOpen && (
          <div className="px-4 pb-4 space-y-1">
            <p className="text-lg font-bold">{INCIDENT_NOT_SURE_RULE}</p>
            <p className="text-sm text-muted-foreground">{INCIDENT_NOT_SURE_NOTE}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** The pop-up shell (closable X, Escape, tap outside; 92dvh with internal scroll). */
export function IncidentModalShell({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[150] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-background w-full sm:max-w-2xl lg:max-w-3xl rounded-t-3xl sm:rounded-3xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3 border-b border-border shrink-0">
          <h2 className="text-xl sm:text-2xl font-bold leading-tight flex items-center gap-2 min-w-0">
            <ShieldAlert className="w-6 h-6 text-red-700 shrink-0" />
            <span>{title}</span>
          </h2>
          <button onClick={onClose} className="w-11 h-11 rounded-2xl bg-secondary flex items-center justify-center flex-shrink-0" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** The chooser in its own pop-up — the diary's "New report". */
export function IncidentKindChooserModal({ onChoose, onClose, busyKind }: {
  onChoose: (kind: IncidentKind) => void;
  onClose: () => void;
  busyKind?: IncidentKind | null;
}) {
  return (
    <IncidentModalShell title={INCIDENT_CHOOSER_QUESTION} onClose={onClose}>
      <PinnedBody bodyClassName="p-5">
        <IncidentKindChooser onChoose={onChoose} busyKind={busyKind} disabled={busyKind != null} />
      </PinnedBody>
    </IncidentModalShell>
  );
}
