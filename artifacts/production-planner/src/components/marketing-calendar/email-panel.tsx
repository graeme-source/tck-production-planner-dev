/**
 * A Klaviyo email, opened from the calendar (2026-10-20). Read-only — it is
 * built and changed in Klaviyo, and the calendar follows within a few
 * minutes. Shows the subject, preview text, send date/time, audience, and
 * its ONE status: Approved or Needs approval. Approvers (the founder or a
 * marketing.approve_emails grant — the server checks) approve or undo here.
 * Approving is recorded in this app only; nothing is written to Klaviyo.
 *
 * Modal rule: explicit X, card capped at 92dvh with internal scrolling.
 */
import { EmailResultsBlock } from "./email-results";
import { createPortal } from "react-dom";
import { format, parseISO } from "date-fns";
import { BadgeCheck, ExternalLink, History, Loader2, Mail, PencilLine, Undo2, Users, X } from "lucide-react";
import { approvalLabel } from "@workspace/marketing-calendar";
import { cn } from "@/lib/utils";
import { useEscapeToClose } from "./use-escape";
import { useApprovalHistory, useSetApproval, type CalEmail } from "./api";
import { APPROVAL_TONE, emailStatusLabel, firstName } from "./constants";

export function sendLine(email: Pick<CalEmail, "status" | "sendAt">): string {
  if (!email.sendAt) return "No send date yet";
  const when = format(parseISO(email.sendAt), "EEE d MMM yyyy, HH:mm");
  if (email.status === "Draft") return `Set to send ${when} (not scheduled yet)`;
  return `${email.status === "Sent" ? "Sent" : "Sends"} ${when}`;
}

export function ApprovalBadge({ email, className }: { email: CalEmail; className?: string }) {
  const a = email.approval;
  // Once sent it's too late to ask — a quiet grey note instead of amber.
  if (a.status !== "approved" && (email.status === "Sent" || email.status === "Sending")) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-sm font-semibold bg-secondary text-muted-foreground border-border", className)}>
        Sent without approval
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-sm font-semibold", APPROVAL_TONE[a.status], className)}>
      {a.status === "approved" ? <BadgeCheck className="w-4 h-4" /> : <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />}
      {approvalLabel(a.status, a.approvedBy, a.changed)}
    </span>
  );
}

/** The one-tap Approve / Undo button (approvers only). */
export function ApproveButton({ email, size = "big", label = "Approve" }: { email: CalEmail; size?: "big" | "small"; label?: string }) {
  const set = useSetApproval();
  const approved = email.approval.status === "approved";
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={e => { e.stopPropagation(); set.mutate({ campaignId: email.id, approve: !approved }); }}
        disabled={set.isPending}
        className={cn(
          "rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-60",
          size === "big" ? "w-full h-12 text-base" : "px-4 h-11 text-sm",
          approved ? "border-2 border-border hover:bg-secondary/50" : "bg-emerald-600 text-white hover:bg-emerald-700",
        )}
      >
        {set.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : approved ? <Undo2 className="w-4 h-4" /> : <BadgeCheck className="w-5 h-5" />}
        {approved ? "Undo approval" : label}
      </button>
      {set.isError && <p className="text-sm text-destructive">{(set.error as Error).message}</p>}
    </div>
  );
}

export function EmailPanel({ email, canApprove, onClose }: { email: CalEmail; canApprove: boolean; onClose: () => void }) {
  const history = useApprovalHistory(email.id);
  useEscapeToClose(onClose);
  const draft = email.status === "Draft";

  return createPortal(
    <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div
        className="bg-card border-2 border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={email.subject ?? email.name}
      >
        <div className="flex items-start gap-3 px-4 sm:px-5 py-3 border-b border-border">
          <span className="w-10 h-10 rounded-xl bg-teal-500/15 text-teal-700 dark:text-teal-300 flex items-center justify-center flex-shrink-0">
            {draft ? <PencilLine className="w-5 h-5" /> : <Mail className="w-5 h-5" />}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Klaviyo email · {emailStatusLabel(email.status)}</p>
            <h2 className="text-lg font-bold leading-snug break-words">{email.name}</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          <ApprovalBadge email={email} />

          <div className="rounded-xl border border-border p-4 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Subject line{email.abTest ? " · A/B test (first version shown)" : ""}
            </p>
            <p className="text-base font-semibold break-words">{email.subject ?? "— no subject line yet"}</p>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-2">Preview text</p>
            <p className="text-sm break-words">{email.previewText ?? <span className="text-muted-foreground">— none</span>}</p>
          </div>

          <p className="text-base font-medium">{sendLine(email)}</p>

          {email.results && (
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Results · {email.results.recipients.toLocaleString("en-GB")} recipients
              </p>
              <EmailResultsBlock r={email.results} />
              <p className="text-xs text-muted-foreground">From Klaviyo (its own attribution), refreshed every 30 minutes.</p>
            </div>
          )}

          <div className="flex items-start gap-2 text-sm">
            <Users className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
            <span className="break-words">
              {email.audiences.length > 0 ? email.audiences.join(", ") : "Audience not shown here — see it in Klaviyo"}
              {email.excludedCount > 0 && <span className="text-muted-foreground"> · {email.excludedCount} excluded</span>}
            </span>
          </div>

          {canApprove
            ? <ApproveButton email={email} />
            : email.approval.status !== "approved" && <p className="text-sm text-muted-foreground">Waiting for approval.</p>}

          <a href={email.klaviyoUrl} target="_blank" rel="noopener noreferrer"
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 hover:bg-primary/90">
            <ExternalLink className="w-4 h-4" /> Open in Klaviyo
          </a>
          <p className="text-sm text-muted-foreground">
            Change or reschedule it in Klaviyo — the calendar picks it up within a few minutes. If the subject, preview text or send time changes after it's approved, it needs approving again.
          </p>

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
                    <p className="text-sm leading-snug break-words"><b>{firstName(h.userName)}</b> {h.summary}</p>
                    <p className="text-xs text-muted-foreground">{format(parseISO(h.at), "d MMM HH:mm")}</p>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
