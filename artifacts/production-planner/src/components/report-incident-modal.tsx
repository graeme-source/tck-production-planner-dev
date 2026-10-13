/**
 * "Report accident / incident" from the quick actions (Graeme, 2026-10-13:
 * "The quick action button should ask, 'Is it an incident or an accident?'
 * and give a brief description of what those things are. If someone
 * doesn't know, it tells them how to identify them, with maybe an example
 * for each."). Objective B. Managers and admins only, like the diary.
 *
 *   1. Two big cards — Accident / Incident — each with what it means and two
 *      examples, plus a "Not sure?" rule.
 *   2. Tapping one starts a NEW report of that type straight away (auto-dated,
 *      reporter recorded) and shows the diary's own report form here —
 *      everything autosaves; it's in Reports → HACCP → Accidents & Incidents.
 *
 * Wording and the card → type mapping: lib/incident-kinds.ts.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, HelpCircle, Loader2, ShieldAlert, X, ExternalLink, Bandage, TriangleAlert } from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { PinnedBody, PinnedFooter, pinnedPrimaryClass } from "@/components/ui/pinned-save-bar";
import {
  INCIDENT_CHOICES, INCIDENT_CHOOSER_QUESTION, INCIDENT_NOT_SURE_NOTE, INCIDENT_NOT_SURE_RULE, INCIDENT_NOT_SURE_TITLE,
  INCIDENT_KIND_LABEL, type IncidentChoice,
} from "@/lib/incident-kinds";
import {
  IncidentReportDetail, INCIDENT_REPORTS_KEY, useCreateIncidentReport, useIncidentReports,
} from "@/components/incident-diary";

/** The HACCP Accident & Incident Diary (Reports → HACCP → Accidents & Incidents). */
export const INCIDENT_DIARY_PATH = "/reports?tab=haccp&haccp=incidents";

const CARD_STYLE: Record<IncidentChoice, { tone: string; icon: typeof Bandage }> = {
  accident: { tone: "border-red-500/70 hover:bg-red-500/10", icon: Bandage },
  incident: { tone: "border-amber-500/70 hover:bg-amber-500/10", icon: TriangleAlert },
};

export function ReportIncidentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [location, navigate] = useLocation();
  const [reportId, setReportId] = useState<number | null>(null);
  const [notSureOpen, setNotSureOpen] = useState(false);
  const { data: reports = [] } = useIncidentReports(open && reportId != null);
  const create = useCreateIncidentReport(row => {
    // Show it straight away, before the list refetch lands.
    queryClient.setQueryData(INCIDENT_REPORTS_KEY, (old: typeof reports | undefined) =>
      old?.some(r => r.id === row.id) ? old : [{ ...row, attachmentCount: 0 }, ...(old ?? [])]);
    setReportId(row.id);
  });

  // Always opens on the question, never on the last report.
  useEffect(() => {
    if (open) { setReportId(null); setNotSureOpen(false); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const report = reportId != null ? reports.find(r => r.id === reportId) ?? null : null;
  const title = report ? `New ${INCIDENT_KIND_LABEL[report.kind].toLowerCase()} report` : INCIDENT_CHOOSER_QUESTION;

  const openDiary = () => {
    onClose();
    // Reports only reads its tab from the address when it first loads.
    if (location === "/reports") window.location.assign(`${import.meta.env.BASE_URL.replace(/\/$/, "")}${INCIDENT_DIARY_PATH}`);
    else navigate(INCIDENT_DIARY_PATH);
  };

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
          <h2 className="text-2xl font-bold flex items-center gap-2 min-w-0">
            <ShieldAlert className="w-6 h-6 text-red-700 shrink-0" />
            <span className="truncate">{title}</span>
          </h2>
          <button onClick={onClose} className="w-11 h-11 rounded-2xl bg-secondary flex items-center justify-center flex-shrink-0" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {reportId == null ? (
          <PinnedBody bodyClassName="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {INCIDENT_CHOICES.map(c => {
                const style = CARD_STYLE[c.choice];
                const Icon = style.icon;
                const busy = create.isPending && create.variables === c.kind;
                return (
                  <button
                    key={c.choice}
                    type="button"
                    onClick={() => create.mutate(c.kind)}
                    disabled={create.isPending}
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
          </PinnedBody>
        ) : (
          <PinnedBody bodyClassName="p-5" footerClassName="p-4">
            {report ? (
              <>
                <p className="text-sm text-muted-foreground mb-4">
                  Auto-dated to now and saved in the Accident &amp; Incident Diary — fill it in, everything saves as you go.
                </p>
                <IncidentReportDetail
                  report={report}
                  onChanged={() => void queryClient.invalidateQueries({ queryKey: INCIDENT_REPORTS_KEY })}
                  onDeleted={onClose}
                />
              </>
            ) : (
              <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            )}
            <PinnedFooter>
              <div className="flex flex-col sm:flex-row gap-2">
                <button type="button" onClick={openDiary}
                  className="min-h-14 px-5 rounded-2xl border-2 border-border text-base font-semibold inline-flex items-center justify-center gap-2 hover:bg-secondary/40 sm:w-auto">
                  <ExternalLink className="w-5 h-5" /> Open the diary
                </button>
                <button type="button" onClick={onClose} className={pinnedPrimaryClass}>
                  Done — it's saved
                </button>
              </div>
            </PinnedFooter>
          </PinnedBody>
        )}
      </div>
    </div>
  );
}
