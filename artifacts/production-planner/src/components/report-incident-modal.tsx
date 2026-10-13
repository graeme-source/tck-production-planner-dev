/**
 * "Report accident / incident" from the quick actions (Graeme, 2026-10-13:
 * "The quick action button should ask, 'Is it an incident or an accident?'
 * and give a brief description of what those things are. If someone
 * doesn't know, it tells them how to identify them, with maybe an example
 * for each."). Objective B. Managers and admins only, like the diary.
 *
 *   1. The chooser (incident-kind-chooser.tsx — the same one the diary's
 *      "New report" shows).
 *   2. Tapping a card starts a NEW report of that type straight away (auto-dated,
 *      reporter recorded) and shows the diary's own report form here —
 *      everything autosaves; it's in Reports → HACCP → Accidents & Incidents.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, ExternalLink } from "lucide-react";
import { useLocation } from "wouter";
import { PinnedBody, PinnedFooter, pinnedPrimaryClass } from "@/components/ui/pinned-save-bar";
import { INCIDENT_CHOOSER_QUESTION, INCIDENT_KIND_LABEL } from "@/lib/incident-kinds";
import {
  IncidentReportDetail, INCIDENT_REPORTS_KEY, useCreateIncidentReport, useIncidentReports,
} from "@/components/incident-diary";
import { IncidentKindChooser, IncidentModalShell } from "@/components/incident-kind-chooser";

/** The HACCP Accident & Incident Diary (Reports → HACCP → Accidents & Incidents). */
export const INCIDENT_DIARY_PATH = "/reports?tab=haccp&haccp=incidents";

export function ReportIncidentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [location, navigate] = useLocation();
  const [reportId, setReportId] = useState<number | null>(null);
  const { data: reports = [] } = useIncidentReports(open && reportId != null);
  const create = useCreateIncidentReport(row => {
    // Show it straight away, before the list refetch lands.
    queryClient.setQueryData(INCIDENT_REPORTS_KEY, (old: typeof reports | undefined) =>
      old?.some(r => r.id === row.id) ? old : [{ ...row, attachmentCount: 0 }, ...(old ?? [])]);
    setReportId(row.id);
  });

  // Always opens on the question, never on the last report.
  useEffect(() => {
    if (open) setReportId(null);
  }, [open]);

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
    <IncidentModalShell title={title} onClose={onClose}>
      {reportId == null ? (
        <PinnedBody bodyClassName="p-5">
          <IncidentKindChooser
            onChoose={kind => create.mutate(kind)}
            busyKind={create.isPending ? create.variables ?? null : null}
            disabled={create.isPending}
          />
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
                className="min-h-14 px-5 rounded-2xl border-2 border-border text-base font-semibold inline-flex items-center justify-center gap-2 hover:bg-secondary/40 whitespace-nowrap shrink-0">
                <ExternalLink className="w-5 h-5" /> Open the diary
              </button>
              <button type="button" onClick={onClose} className={pinnedPrimaryClass}>
                Done — it's saved
              </button>
            </div>
          </PinnedFooter>
        </PinnedBody>
      )}
    </IncidentModalShell>
  );
}
