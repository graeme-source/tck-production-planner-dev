/**
 * The small "In review · Timekeeping" / "Formal · First written warning ·
 * Attendance" pill, plus "Live warning until …" when a warning is still on
 * file. Only ever rendered from data the server sent this viewer (People
 * access, never their own) — it has no access logic of its own.
 */
import { ShieldAlert, Scale, FileWarning } from "lucide-react";
import { fmtDayIso, type ReviewBadge } from "@workspace/people-reviews";
import { cn } from "@/lib/utils";

export function ReviewStatusBadge({ badge, liveWarningUntil, size = "md", className }: {
  badge: ReviewBadge | null;
  liveWarningUntil?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  if (!badge && !liveWarningUntil) return null;
  const pill = cn(
    "inline-flex items-center gap-1.5 font-bold rounded-lg",
    size === "sm" ? "text-sm px-2.5 py-1" : "text-base px-3 py-1.5",
  );
  const icon = size === "sm" ? "w-4 h-4" : "w-5 h-5";
  return (
    <span className={cn("inline-flex flex-wrap gap-2", className)}>
      {badge && (
        <span
          className={cn(pill, badge.level === "formal"
            ? "bg-rose-100 text-rose-900 dark:bg-rose-950/50 dark:text-rose-200"
            : "bg-violet-100 text-violet-900 dark:bg-violet-950/50 dark:text-violet-200")}
        >
          {badge.level === "formal" ? <Scale className={icon} /> : <ShieldAlert className={icon} />}
          {badge.label}{badge.otherOpen > 0 ? ` +${badge.otherOpen} more` : ""}
        </span>
      )}
      {liveWarningUntil && (
        <span className={cn(pill, "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200")}>
          <FileWarning className={icon} /> Live warning until {fmtDayIso(liveWarningUntil)}
        </span>
      )}
    </span>
  );
}
