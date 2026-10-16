/**
 * Short shelf life on a goods-in line (Graeme, 2026-10-16). Objective D.
 *
 * Shown on a receive-dialog line the moment its use-by is fewer days after
 * the delivery day than the ingredient's minimum. The receiver decides —
 * accept it anyway (we'll use or freeze it) or reject it (not received) —
 * and either way the supplier's account manager is emailed when goods-in is
 * saved, with photos of the items (issue-photos.tsx). It never blocks receiving outright: it's their call, but they must
 * make it. Rule and wording: @workspace/goods-in shelf-life.ts.
 */
import { AlertTriangle, Check, Mail, RotateCcw, X } from "lucide-react";
import { shelfLifeWarningText, shortDayLabel, shelfLifePhrase, issueEmailStatusText, type ShelfLifeCheck } from "@workspace/goods-in";
import { cn } from "@/lib/utils";
import { IssuePhotoStrip } from "./issue-photos";

export function ShelfLifeWarning({
  check,
  supplierName,
  accepted,
  onAccept,
  onReject,
  onUndo,
}: {
  check: ShelfLifeCheck;
  supplierName: string;
  accepted: boolean;
  onAccept: () => void;
  onReject: () => void;
  onUndo: () => void;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-xl border-4 p-3 space-y-3",
        accepted ? "border-red-300 bg-red-50/60 dark:bg-red-950/20" : "border-red-600 bg-red-50 dark:bg-red-950/40",
      )}
    >
      <p className="text-lg sm:text-xl font-bold text-red-800 dark:text-red-200 flex items-start gap-2">
        <AlertTriangle className="w-7 h-7 shrink-0 text-red-600" />
        <span>{shelfLifeWarningText(check, supplierName)}</span>
      </p>
      {accepted ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex-1 min-w-[14rem] text-base font-semibold text-red-900 dark:text-red-200 flex items-center gap-2">
            <Check className="w-5 h-5 shrink-0" strokeWidth={3} />
            Accepted anyway — use it or freeze it. Take the photo below; {supplierName} will be emailed with it when you save.
          </p>
          <button
            type="button"
            onClick={onUndo}
            className="min-h-[44px] px-4 rounded-xl border-2 border-border bg-background text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-secondary/60"
          >
            <RotateCcw className="w-4 h-4" /> Change
          </button>
        </div>
      ) : (
        <>
          <p className="text-base font-semibold text-red-900 dark:text-red-200">
            Decide before saving. Either way {supplierName} are emailed automatically, with a photo of the items.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onAccept}
              className="min-h-[56px] rounded-xl border-2 border-amber-500 bg-background text-amber-900 dark:text-amber-200 text-lg font-bold inline-flex items-center justify-center gap-2 px-3 hover:bg-amber-50 dark:hover:bg-amber-900/20"
            >
              <Check className="w-5 h-5 shrink-0" strokeWidth={3} /> Accept anyway (we'll use/freeze it)
            </button>
            <button
              type="button"
              onClick={onReject}
              className="min-h-[56px] rounded-xl border-2 border-red-600 bg-red-600 text-white text-lg font-bold inline-flex items-center justify-center gap-2 px-3 hover:bg-red-700"
            >
              <X className="w-5 h-5 shrink-0" strokeWidth={3} /> Reject it
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** The recorded decision on a line already saved — and whether the supplier
 *  email went, so a failed send is visible to whoever opens the delivery. */
export function ShelfLifeRecordNote({
  record,
  supplierName,
}: {
  record: {
    decision: string; useByDate: string; shelfLifeDays: number; minShelfLifeDays: number;
    decidedByName: string | null; decidedAt: string;
    emailStatus: string; emailError: string | null; emailedToName: string | null; emailedAt: string | null;
    /** Photos sent with the report (migration 0198). */
    photoIds?: number[];
  };
  supplierName: string;
}) {
  const when = new Date(record.decidedAt).toLocaleString("en-GB", {
    timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
  const decided = `${record.decision === "rejected" ? "Rejected" : "Accepted"} for short shelf life (${shelfLifePhrase(record.shelfLifeDays)}, use-by ${shortDayLabel(record.useByDate)}, ${record.minShelfLifeDays} promised)${record.decidedByName ? ` by ${record.decidedByName}` : ""}, ${when}.`;
  const email = issueEmailStatusText(record, supplierName);
  return (
    <div className={cn(
      "rounded-lg px-3 py-2 text-sm space-y-2",
      email.ok ? "bg-secondary/60 text-muted-foreground" : "bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-200 font-semibold",
    )}>
      <p className="flex items-start gap-2">
        <Mail className="w-4 h-4 shrink-0 mt-0.5" />
        <span className="min-w-0 break-words">{decided} {email.text}</span>
      </p>
      <IssuePhotoStrip photoIds={record.photoIds ?? []} />
    </div>
  );
}

/** On a line that was rejected for its shelf life. */
export function ShelfLifeRejectedNote({
  check,
  useByDate,
  supplierName,
  alreadyReported,
}: {
  check: ShelfLifeCheck | null;
  useByDate: string;
  supplierName: string;
  alreadyReported: boolean;
}) {
  return (
    <p className="text-base font-semibold text-red-800 dark:text-red-300 flex items-start gap-2">
      <Mail className="w-5 h-5 shrink-0 mt-0.5" />
      <span>
        Rejected for short shelf life
        {check ? ` — ${shelfLifePhrase(check.days)} (use-by ${shortDayLabel(useByDate)}), at least ${check.minDays} ${check.minDays === 1 ? "day" : "days"} promised` : ""}.
        {" "}
        {alreadyReported ? `${supplierName} have been told.` : `${supplierName} will be emailed when you save.`}
        {" "}Tap Received if it's being kept after all.
      </span>
    </p>
  );
}
