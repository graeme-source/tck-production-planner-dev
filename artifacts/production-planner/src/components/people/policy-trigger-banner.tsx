/**
 * The attendance policy trigger on a person's record (Graeme, 2026-10-12):
 * red only while a review is still needed — due, or due again after new
 * lates / sickness since the last review. A review booked or already held
 * shows calmly, and names (and links to) that review. The state comes from
 * the server (GET /api/people/:userId → triggerReview), worked out by the
 * shared rule in @workspace/people-reviews.
 */
import { AlertTriangle, CalendarDays, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  needsPolicyReview, policyTriggerLine, type PolicyReviewRef, type PolicyTriggerStatus,
} from "@workspace/people-reviews";

export function PolicyTriggerBanner({ status, months, canManage, onBook, onOpenReview }: {
  status: PolicyTriggerStatus;
  months: number;
  canManage: boolean;
  onBook: () => void;
  /** Show the review this line names (null = can't be opened here). */
  onOpenReview: ((r: PolicyReviewRef) => void) | null;
}) {
  const line = policyTriggerLine(status, months);
  const review = status.state === "booked" ? status.booked : status.lastReview;

  if (needsPolicyReview(status)) {
    return (
      <div className="rounded-2xl border-2 border-rose-400 dark:border-rose-700 bg-rose-50 dark:bg-rose-950/30 p-4 flex items-center gap-3 flex-wrap">
        <AlertTriangle className="w-6 h-6 text-rose-600 shrink-0" />
        <p className="flex-1 min-w-0 text-base font-semibold text-rose-900 dark:text-rose-200">
          {line}
          {status.lastReview && onOpenReview && (
            <> <button type="button" onClick={() => onOpenReview(status.lastReview!)} className="underline underline-offset-2 font-semibold">See the review</button></>
          )}
        </p>
        {canManage && (
          <button onClick={onBook} className="h-12 px-4 rounded-xl bg-rose-600 text-white font-bold">
            {status.state === "due_again" ? "Book a follow-up" : "Book a review"}
          </button>
        )}
      </div>
    );
  }

  // Booked or handled: calm, and the line itself opens the review.
  const Icon = status.state === "booked" ? CalendarDays : CheckCircle2;
  const text = review && onOpenReview ? (
    <button type="button" onClick={() => onOpenReview(review)} className="text-left underline underline-offset-2 decoration-muted-foreground/50 hover:text-primary">
      {line}
    </button>
  ) : line;
  return (
    <div className={cn("rounded-2xl border-2 border-border bg-secondary/30 px-4 py-3 flex items-center gap-3")}>
      <Icon className={cn("w-5 h-5 shrink-0", status.state === "booked" ? "text-primary" : "text-emerald-600")} />
      <p className="flex-1 min-w-0 text-sm font-semibold text-muted-foreground">{text}</p>
    </div>
  );
}
