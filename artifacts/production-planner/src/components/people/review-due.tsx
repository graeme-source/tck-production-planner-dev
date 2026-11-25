/**
 * Last review and "No review required" on screen (Graeme, 25 Nov 2026):
 *   • ReviewDuePill   — Up to date · Overdue · Possibly overdue · No review required
 *   • ReviewDueCell   — the People list's Last review cell, with a ⋮ menu to
 *                       switch No review required without opening the record
 *   • ReviewDueCard   — the card on a person's record, with the switch
 *
 * The rule is reviewDue() in @workspace/people-reviews (tested); the data is
 * routes/people-review-due.ts, which only ever sends people the viewer may
 * open (never their own). The switch saves straight away with its save
 * state showing (charter rule 5).
 */
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarCheck, CheckCircle2, Loader2, MinusCircle, MoreVertical } from "lucide-react";
import { reviewDue, fmtDayIso, londonTodayIso, type ReviewDue } from "@workspace/people-reviews";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePersonReviewDue, saveNoReviewRequired, reviewDueListKey, type ReviewDueRow } from "./reviews-api";

const TONE_CLASS: Record<ReviewDue["tone"], string> = {
  green: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200",
  // Overdue and Possibly overdue look almost the same on purpose, so the
  // overview reads at a glance: same shape, icon and border, red vs amber.
  red: "bg-rose-100 text-rose-900 border-2 border-rose-300 dark:bg-rose-950/50 dark:text-rose-200 dark:border-rose-800",
  amber: "bg-amber-100 text-amber-900 border-2 border-amber-300 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800",
  muted: "bg-secondary text-muted-foreground",
};

export function ReviewDuePill({ due, size = "sm" }: { due: ReviewDue; size?: "sm" | "md" }) {
  const Icon = due.tone === "green" ? CheckCircle2 : due.tone === "muted" ? MinusCircle : AlertTriangle;
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 font-bold rounded-lg whitespace-nowrap",
      size === "sm" ? "text-xs px-2 py-0.5" : "text-sm px-2.5 py-1",
      TONE_CLASS[due.tone],
    )}>
      <Icon className={size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4"} /> {due.label}
    </span>
  );
}

/** After a switch: the list column and this person's card. */
function useAfterSwitch() {
  const qc = useQueryClient();
  return () => { void qc.invalidateQueries({ queryKey: reviewDueListKey }); };
}

/**
 * The Last review cell. `row` missing = nothing to show for this viewer
 * (their own row, or still loading) — a dash, never a guess.
 */
export function ReviewDueCell({ row, today, personName }: { row: ReviewDueRow | undefined; today: string | undefined; personName: string }) {
  const after = useAfterSwitch();
  const auto = useAutosave(async (on: boolean) => {
    if (!row) return;
    await saveNoReviewRequired(row.userId, on);
    after();
    toast({ title: on ? `${personName}: No review required` : `${personName}: reviews required again` });
  }, 0);
  if (!row || !today) return <span className="text-muted-foreground">—</span>;
  const due = reviewDue(row, today);
  const flip = () => { auto.schedule(!row.noReviewRequired); void auto.flush(); };
  return (
    <div className="flex items-center gap-1">
      <div className="flex-1 min-w-0 space-y-1">
        {due.state !== "not_required" && (
          <span className="block leading-snug">
            <span className={cn("font-semibold whitespace-nowrap", due.state === "no_record" && "text-muted-foreground")}>{due.dateText}</span>
            {due.agoText && <span className="block text-xs text-muted-foreground">{due.agoText}</span>}
          </span>
        )}
        <ReviewDuePill due={due} />
        {auto.state === "saving" && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /> Saving…</span>}
        {auto.state === "error" && <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />}
      </div>
      {/* Rows open the record on tap — keep taps on the menu (and its
          portalled content, which bubbles through React) to the menu. */}
      <div onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Review options for ${personName}`}
            className="w-9 h-11 -mr-1 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <MoreVertical className="w-5 h-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel className="text-base">{personName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-12 text-base font-semibold gap-2" onSelect={flip}>
              {row.noReviewRequired
                ? <><CalendarCheck className="w-5 h-5" /> Reviews required again</>
                : <><MinusCircle className="w-5 h-5" /> Set to No review required</>}
            </DropdownMenuItem>
            {!row.noReviewRequired && (
              <p className="px-2 pb-2 text-sm text-muted-foreground">For directors, owners and contractors — they're never flagged as overdue.</p>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** The review card on a person's record: last review, when the next is
 *  due, and the No review required switch. Hidden when the server won't
 *  give it (your own record). */
export function ReviewDueCard({ userId, ready, canWrite, onOpenEntry }: {
  userId: number;
  ready: boolean;
  canWrite: boolean;
  /** Open the review itself on the record (the date is its link). */
  onOpenEntry?: (entryId: number) => void;
}) {
  const q = usePersonReviewDue(userId, ready && canWrite);
  const after = useAfterSwitch();
  const auto = useAutosave(async (on: boolean) => {
    await saveNoReviewRequired(userId, on);
    after();
  }, 0);
  if (!canWrite || q.isError) return null;
  if (!q.data) {
    return (
      <div className="rounded-2xl border-2 border-border px-4 py-3 flex items-center gap-2 text-base text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" /> Checking their last review…
      </div>
    );
  }
  const row = q.data;
  const due = reviewDue(row, row.today);
  const on = row.noReviewRequired;
  const flip = () => { auto.schedule(!on); void auto.flush(); };
  return (
    <div className="rounded-2xl border-2 border-border p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <CalendarCheck className="w-6 h-6 text-primary shrink-0" />
        <div className="flex-1 min-w-[12rem]">
          <p className="text-sm font-semibold text-muted-foreground">Last performance review</p>
          <p className="text-lg font-bold leading-snug">
            {row.lastReviewDate && row.lastReviewEntryId != null && onOpenEntry ? (
              <button type="button" onClick={() => onOpenEntry(row.lastReviewEntryId!)} className="underline decoration-2 underline-offset-4 hover:text-primary text-left">
                {fmtDayIso(row.lastReviewDate)}
              </button>
            ) : row.lastReviewDate ? fmtDayIso(row.lastReviewDate) : "No record"}
            {due.agoText && <span className="text-base font-medium text-muted-foreground"> · {due.agoText}</span>}
          </p>
          {due.dueOn && due.state !== "not_required" && (
            <p className="text-sm text-muted-foreground">
              {due.state === "overdue" ? "Was due" : "Next due"} {fmtDayIso(due.dueOn)}
            </p>
          )}
        </div>
        <ReviewDuePill due={due} size="md" />
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={flip}
        disabled={auto.state === "saving"}
        className={cn(
          "w-full min-h-14 px-4 py-2 rounded-2xl border-2 flex items-center gap-3 text-left transition-colors disabled:opacity-70",
          on ? "border-primary bg-primary/10" : "border-border hover:bg-secondary/50",
        )}
      >
        <span className="flex-1 min-w-0">
          <span className="block text-base font-bold">No review required</span>
          <span className="block text-sm text-muted-foreground">For directors, owners and contractors — never flagged as overdue.</span>
        </span>
        <span aria-hidden className={cn("relative w-14 h-8 rounded-full shrink-0 transition-colors", on ? "bg-primary" : "bg-input")}>
          <span className={cn("absolute top-1 w-6 h-6 rounded-full bg-background shadow transition-all", on ? "left-7" : "left-1")} />
        </span>
      </button>
      {(auto.state !== "idle" || (row.setByName && row.setAt)) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />
          {auto.state !== "saving" && auto.state !== "error" && row.setByName && row.setAt && (
            <span className="text-sm text-muted-foreground">
              {on ? "Set" : "Switched off"} by {row.setByName} on {fmtDayIso(londonTodayIso(new Date(row.setAt)))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
