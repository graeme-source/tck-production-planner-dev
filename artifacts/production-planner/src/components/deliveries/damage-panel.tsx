/**
 * Damaged / broken items on a goods-in line (Graeme, 2026-10-16). Objective D.
 *
 * Any received line can be marked Damaged / broken: how many (defaults to
 * everything that arrived, in the same unit as the Received box), an
 * optional note ("2 bags split"), and whether the damaged ones are KEPT
 * (we'll use what we can) or REJECTED (taken off what's received — the
 * stock receipt books in only what's kept). The receiver must choose kept
 * or rejected before saving. On save the damage is recorded and reported to
 * the supplier in the one delivery email, with the photos. Rules:
 * @workspace/goods-in delivery-issues.ts.
 */
import { Check, Mail, PackageX, X } from "lucide-react";
import { NumberInput } from "@/components/ui/number-input";
import { issueEmailStatusText, type DamageDisposition } from "@workspace/goods-in";
import { cn } from "@/lib/utils";
import { IssuePhotoStrip } from "./issue-photos";

export interface LineDamage {
  /** In the line's stored unit (like quantityReceived). */
  quantity: number;
  disposition: DamageDisposition | null;
  note: string;
}

/** How the line's quantity is shown: whole packs for pack-counted
 *  ingredients stored by weight, otherwise the line unit. */
export function damageDisplay(line: { unit: string; stockInPacks?: boolean; packWeight?: number | null }) {
  const inPacks = !!line.stockInPacks && (line.packWeight ?? 0) > 0;
  const isPackUnit = line.unit === "packs" || line.unit === "bottles" || line.unit === "pallets";
  const pw = Number(line.packWeight) || 1;
  const convert = inPacks && !isPackUnit;
  return {
    toDisplay: (n: number) => (convert ? Math.round((n / pw) * 100) / 100 : n),
    fromDisplay: (n: number) => (convert ? n * pw : n),
    unitLabel: convert || inPacks ? "packs" : line.unit,
    step: inPacks ? 1 : 0.5,
  };
}

export function DamagePanel({
  line,
  arrived,
  damage,
  onChange,
}: {
  line: { ingredientName: string; unit: string; stockInPacks?: boolean; packWeight?: number | null };
  /** What arrived (the Received box). */
  arrived: number;
  damage: LineDamage | null;
  onChange: (d: LineDamage | null) => void;
}) {
  const disp = damageDisplay(line);
  if (!damage) {
    return (
      <button
        type="button"
        onClick={() => onChange({ quantity: arrived, disposition: null, note: "" })}
        className="min-h-[48px] w-full sm:w-auto px-4 rounded-xl border-2 border-dashed border-orange-500 text-orange-800 dark:text-orange-200 text-base font-bold inline-flex items-center justify-center gap-2 hover:bg-orange-50 dark:hover:bg-orange-950/20"
      >
        <PackageX className="w-5 h-5" /> Damaged / broken?
      </button>
    );
  }
  const tooMany = damage.quantity > arrived;
  return (
    <div className="rounded-xl border-4 border-orange-500 bg-orange-50 dark:bg-orange-950/30 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-lg font-bold text-orange-900 dark:text-orange-100 flex items-center gap-2">
          <PackageX className="w-6 h-6 shrink-0" /> Damaged / broken
        </p>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="min-h-[44px] px-3 rounded-xl border-2 border-border bg-background text-sm font-semibold inline-flex items-center gap-1"
        >
          <X className="w-4 h-4" /> Not damaged
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,14rem)_1fr] gap-3">
        <div className="min-w-0">
          <label className="text-base font-semibold text-muted-foreground block mb-1">How many damaged ({disp.unitLabel})</label>
          <NumberInput
            step={disp.step}
            min="0"
            inputMode={disp.step === 1 ? "numeric" : "decimal"}
            value={disp.toDisplay(damage.quantity)}
            onChange={(n) => onChange({ ...damage, quantity: Math.max(0, disp.fromDisplay(n)) })}
            className={cn(
              "w-full px-3 py-2 bg-background border-2 rounded-lg text-xl font-bold tabular-nums focus:outline-none",
              tooMany || !(damage.quantity > 0) ? "border-destructive" : "border-border",
            )}
          />
          {tooMany && <p className="text-sm text-destructive mt-1">More than arrived ({disp.toDisplay(arrived)} {disp.unitLabel}).</p>}
        </div>
        <div className="min-w-0">
          <label className="text-base font-semibold text-muted-foreground block mb-1">What's wrong (optional)</label>
          <input
            type="text"
            value={damage.note}
            maxLength={300}
            placeholder="e.g. 2 bags split"
            onChange={(e) => onChange({ ...damage, note: e.target.value })}
            className="w-full px-3 py-2 bg-background border-2 border-border rounded-lg text-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="group" aria-label={`${line.ingredientName}: keep or reject the damaged ones`}>
        <button
          type="button"
          aria-pressed={damage.disposition === "kept"}
          onClick={() => onChange({ ...damage, disposition: "kept" })}
          className={cn(
            "min-h-[56px] rounded-xl border-2 text-lg font-bold inline-flex items-center justify-center gap-2 px-3",
            damage.disposition === "kept" ? "bg-amber-500 border-amber-500 text-white" : "border-amber-500 bg-background text-amber-900 dark:text-amber-200",
          )}
        >
          <Check className="w-5 h-5" strokeWidth={3} /> Keep them (we'll use what we can)
        </button>
        <button
          type="button"
          aria-pressed={damage.disposition === "rejected"}
          onClick={() => onChange({ ...damage, disposition: "rejected" })}
          className={cn(
            "min-h-[56px] rounded-xl border-2 text-lg font-bold inline-flex items-center justify-center gap-2 px-3",
            damage.disposition === "rejected" ? "bg-red-600 border-red-600 text-white" : "border-red-600 bg-background text-red-800 dark:text-red-200",
          )}
        >
          <X className="w-5 h-5" strokeWidth={3} /> Reject them (not received)
        </button>
      </div>
      <p className="text-base font-semibold text-orange-900 dark:text-orange-200">
        {damage.disposition === "rejected"
          ? `${disp.toDisplay(Math.min(damage.quantity, arrived))} ${disp.unitLabel} come off what's received — ${disp.toDisplay(Math.max(0, arrived - damage.quantity))} ${disp.unitLabel} go into stock. `
          : damage.disposition === "kept" ? "Kept — all of it goes into stock. " : "Choose keep or reject before saving. "}
        The supplier is emailed with the photos when you save.
      </p>
    </div>
  );
}

/** A damage report already saved for this line — read-only, with whether
 *  the supplier email went. */
export function DamageRecordNote({
  record,
  supplierName,
  unitLabel,
}: {
  record: {
    quantity: number; note: string | null; disposition: string; reportedByName: string | null; reportedAt: string;
    emailStatus: string; emailError: string | null; emailedToName: string | null; photoIds?: number[];
  };
  supplierName: string;
  unitLabel: string;
}) {
  const when = new Date(record.reportedAt).toLocaleString("en-GB", {
    timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
  const email = issueEmailStatusText(record, supplierName);
  return (
    <div className={cn(
      "rounded-lg px-3 py-2 text-sm space-y-2",
      email.ok ? "bg-secondary/60 text-muted-foreground" : "bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-200 font-semibold",
    )}>
      <p className="flex items-start gap-2">
        <Mail className="w-4 h-4 shrink-0 mt-0.5" />
        <span className="min-w-0 break-words">
          Damaged: {record.quantity} {unitLabel} {record.disposition === "rejected" ? "rejected" : "kept"}
          {record.note ? ` (${record.note})` : ""}{record.reportedByName ? ` — reported by ${record.reportedByName}` : ""}, {when}. {email.text}
        </span>
      </p>
      <IssuePhotoStrip photoIds={record.photoIds ?? []} />
    </div>
  );
}
