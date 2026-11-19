/**
 * "Report accident / incident" from the quick actions. Objective B.
 *
 * Since 2026-11-19 (Graeme: "the first step is just to dictate what the
 * incident is, and then it creates the incident report based on our
 * dictation, so we don't have to do loads of work"; "make it really easy for
 * the team to report"):
 *
 *   1. Say (or type) what happened — one big box with the dictate button.
 *   2. "Write the report" — AI fills in the diary's fields from the words
 *      (only what was said), works out accident / incident / near miss, and
 *      spots a supplier's product at fault. It's saved straight away.
 *   3. The report shows here to check and add photos; if a supplier's
 *      product was at fault, the supplier step offers the email.
 *
 * Open to everyone. The reporter sees their own report; managers sign it in
 * Reports → HACCP → Accidents & Incidents.
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ExternalLink, Sparkles } from "lucide-react";
import { useLocation } from "wouter";
import { PinnedBody, PinnedFooter, pinnedPrimaryClass } from "@/components/ui/pinned-save-bar";
import { INCIDENT_KIND_LABEL } from "@/lib/incident-kinds";
import {
  IncidentReportDetail, INCIDENT_REPORTS_KEY, incidentReportKey, useIncidentReport, type IncidentReport,
} from "@/components/incident-diary";
import { IncidentModalShell } from "@/components/incident-kind-chooser";
import { DictateButton } from "@/components/dictate-button";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "@/hooks/use-toast";

/** The HACCP Accident & Incident Diary (Reports → HACCP → Accidents & Incidents). */
export const INCIDENT_DIARY_PATH = "/reports?tab=haccp&haccp=incidents";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function ReportIncidentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { state } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const isManager = user?.role === "admin" || user?.role === "manager";
  const [location, navigate] = useLocation();
  const [reportId, setReportId] = useState<number | null>(null);
  const [text, setText] = useState("");
  const { data: report } = useIncidentReport(open ? reportId : null);

  const write = useMutation({
    mutationFn: async (words: string) => {
      const res = await fetch(`${BASE}/api/incidents/dictate`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: words }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't save the report");
      return res.json() as Promise<IncidentReport & { usedAi: boolean }>;
    },
    onSuccess: row => {
      queryClient.setQueryData(incidentReportKey(row.id), row);
      void queryClient.invalidateQueries({ queryKey: INCIDENT_REPORTS_KEY });
      setReportId(row.id);
      if (!row.usedAi) toast({ title: "Saved as you said it", description: "The AI write-up wasn't available, so your words are the description. Fill in the rest below." });
    },
    onError: e => toast({ title: "Couldn't save the report", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  // Always opens on a fresh, empty box.
  useEffect(() => {
    if (open) { setReportId(null); setText(""); }
  }, [open]);

  if (!open) return null;

  const title = report ? `${INCIDENT_KIND_LABEL[report.kind]} report` : "What happened?";

  const openDiary = () => {
    onClose();
    // Reports only reads its tab from the address when it first loads.
    if (location === "/reports") window.location.assign(`${BASE}${INCIDENT_DIARY_PATH}`);
    else navigate(INCIDENT_DIARY_PATH);
  };

  const refresh = () => {
    if (reportId != null) void queryClient.invalidateQueries({ queryKey: incidentReportKey(reportId) });
    void queryClient.invalidateQueries({ queryKey: INCIDENT_REPORTS_KEY });
  };

  return (
    <IncidentModalShell title={title} onClose={onClose}>
      {reportId == null ? (
        <PinnedBody bodyClassName="p-5" footerClassName="p-4">
          <div className="space-y-3">
            <p className="text-base text-muted-foreground">
              Tap the mic and say what happened, where, what food was affected and what you did. Or type it.
            </p>
            <textarea
              rows={7}
              value={text}
              onChange={e => setText(e.target.value)}
              disabled={write.isPending}
              placeholder="e.g. Found a sharp bone about 1 cm long in the duck while shredding it in the prep room this morning. Took it out, checked the rest of the tray. Duck is from Best Butcher."
              className="block w-full px-4 py-3 bg-background border-2 border-border rounded-2xl text-base leading-relaxed"
            />
            <DictateButton value={text} onChange={setText} context="note" size="lg" />
          </div>
          <PinnedFooter>
            <button type="button" onClick={() => write.mutate(text.trim())} disabled={text.trim().length < 3 || write.isPending}
              className={`${pinnedPrimaryClass} inline-flex items-center justify-center gap-2`}>
              {write.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
              {write.isPending ? "Writing the report…" : "Write the report"}
            </button>
          </PinnedFooter>
        </PinnedBody>
      ) : (
        <PinnedBody bodyClassName="p-5" footerClassName="p-4">
          {report ? (
            <>
              <p className="text-sm text-muted-foreground mb-4">
                Written up from what you said and saved. Check it, add photos, and change anything that's wrong — it saves as you go.
              </p>
              <IncidentReportDetail report={report} onChanged={refresh} onDeleted={onClose} />
            </>
          ) : (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          )}
          <PinnedFooter>
            <div className="flex flex-col sm:flex-row gap-2">
              {isManager && (
                <button type="button" onClick={openDiary}
                  className="min-h-14 px-5 rounded-2xl border-2 border-border text-base font-semibold inline-flex items-center justify-center gap-2 hover:bg-secondary/40 whitespace-nowrap shrink-0">
                  <ExternalLink className="w-5 h-5" /> Open the diary
                </button>
              )}
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
