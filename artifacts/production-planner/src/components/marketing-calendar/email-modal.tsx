/**
 * A Klaviyo email on the marketing calendar, opened. Read-only — you change
 * or reschedule it in Klaviyo and the calendar follows (Graeme, 2026-09-30).
 *
 * Approval (2026-09-30): everyone sees whether it's approved; approvers
 * (founder or a marketing.approve_emails grant) can approve or undo here,
 * even when no planned email is linked to it. Nothing is written to Klaviyo.
 */
import { useMemo } from "react";
import { createPortal } from "react-dom";
import { format, parseISO } from "date-fns";
import { ExternalLink, History, Mail, Users, X } from "lucide-react";
import { stageFromKlaviyo, stageLabel } from "@workspace/marketing-calendar";
import { cn } from "@/lib/utils";
import { useApprovalHistory, type KlaviyoEmail } from "./api";
import { ApprovalPanel, useApprovalIndex } from "./approvals";
import { firstName } from "./constants";

const NO_PLANS: never[] = [];

export function EmailModal({ email, today, onClose }: { email: KlaviyoEmail; today: string; onClose: () => void }) {
  const sent = email.status === "Sent";
  const draft = email.status === "Draft";
  const list = useMemo(() => [email], [email]);
  const index = useApprovalIndex(NO_PLANS, list, today);
  const item = index.forKlaviyo(email.id);
  const history = useApprovalHistory(item?.key ?? null);
  const stage = stageFromKlaviyo(email.status);

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[92dvh] overflow-y-auto overscroll-contain"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={email.name}
      >
        <div className="flex items-start gap-3 p-5 border-b border-border">
          <span className="w-10 h-10 rounded-xl bg-sky-500/15 text-sky-700 dark:text-sky-300 flex items-center justify-center flex-shrink-0">
            <Mail className="w-5 h-5" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Klaviyo email{draft ? " · draft" : ""}</p>
            <h2 className="text-lg font-bold leading-snug">{email.name}</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(
              "px-2.5 py-1 rounded-full text-xs font-semibold",
              sent ? "bg-secondary text-muted-foreground" : draft ? "bg-violet-500/15 text-violet-700 dark:text-violet-300" : "bg-sky-500/15 text-sky-700 dark:text-sky-300",
            )}>
              {stage ? stageLabel(stage) : email.status}
            </span>
            <span className="text-sm font-medium">
              {draft
                ? `Draft — set to send ${format(parseISO(email.sendAt), "EEE d MMM yyyy, HH:mm")} (not scheduled yet)`
                : `${sent ? "Sent" : "Sends"} ${format(parseISO(email.sendAt), "EEE d MMM yyyy, HH:mm")}`}
            </span>
          </div>

          <div className="rounded-xl border border-border p-4 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Subject line{email.abTest ? " · A/B test (first version shown)" : ""}
            </p>
            <p className="text-base font-semibold">{email.subject ?? "—"}</p>
            {email.previewText && <p className="text-sm text-muted-foreground">{email.previewText}</p>}
          </div>

          <div className="flex items-start gap-2 text-sm">
            <Users className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
            <span>
              {email.audiences.length > 0 ? email.audiences.join(", ") : "No audience set"}
              {email.excludedCount > 0 && <span className="text-muted-foreground"> · {email.excludedCount} excluded</span>}
            </span>
          </div>

          <ApprovalPanel
            item={item}
            row={item ? index.row(item.key) : null}
            canApprove={index.canApprove}
            target={{ klaviyoCampaignId: email.id }}
          />

          {history.data && history.data.history.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <History className="w-4 h-4" /> Approval history
              </h3>
              <ol className="relative border-l-2 border-border ml-2 space-y-2">
                {history.data.history.map(h => (
                  <li key={h.id} className="pl-4 relative">
                    <span className={cn("absolute -left-[7px] top-1.5 w-3 h-3 rounded-full border-2 border-card",
                      h.action === "approved" ? "bg-emerald-500" : "bg-muted-foreground")} />
                    <p className="text-sm leading-snug"><b>{firstName(h.userName)}</b> {h.summary}</p>
                    <p className="text-xs text-muted-foreground">{format(parseISO(h.at), "d MMM HH:mm")}</p>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <p className="text-sm text-muted-foreground">
            Change or reschedule this in Klaviyo — the calendar picks it up within a few minutes.
          </p>

          <a href={email.klaviyoUrl} target="_blank" rel="noopener noreferrer"
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 hover:bg-primary/90">
            <ExternalLink className="w-4 h-4" /> Open in Klaviyo
          </a>
        </div>
      </div>
    </div>,
    document.body,
  );
}
