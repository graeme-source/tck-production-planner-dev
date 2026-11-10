/**
 * One goods-in line as a single compact row (Graeme, 9 Nov 2026: receiving
 * a 9–10 item order meant "constantly" scrolling up and down). Objective D.
 *
 * Tablet / desktop: Arrived? (tick / cross, well apart) · "8 bottles
 * Whole Milk" (ordered quantity in front of the name — Graeme, 10 Nov
 * 2026; no storage location, it isn't needed at the door) · received
 * stepper · use-by · damaged — one row each, columns lined up under a
 * header, so a whole order fits on an iPad screen. Phone: the same cells
 * wrap onto a second line. Anything that needs more room — the short
 * shelf-life decision, the damaged panel, earlier reports — opens
 * underneath that one row only. Rules are unchanged: @workspace/goods-in,
 * lib/receiving-row.ts.
 */
import type { CSSProperties } from "react";
import { AlertTriangle, Check, Minus, PackageX, Plus, X } from "lucide-react";
import { checkShelfLife, type LineDecision } from "@workspace/goods-in";
import { palletReceiptLabel } from "@workspace/units";
import { NumberInput } from "@/components/ui/number-input";
import { packNoun, packSizeHint } from "@/pages/station/shared/prep-helpers";
import { cn } from "@/lib/utils";
import { decisionForQuantity, receivingColumns, rowQuantity, rowTone, type RowTone } from "@/lib/receiving-row";
import { ShelfLifeWarning, ShelfLifeRejectedNote, ShelfLifeRecordNote } from "./shelf-life-warning";
import { DamagePanel, DamageRecordNote, type LineDamage } from "./damage-panel";

export interface ReceivingLine {
  lineId: number;
  ingredientName: string;
  ingredientCategory: string | null;
  quantityOrdered: number;
  quantityReceived: number;
  unit: string;
  // The ingredient's native unit (kg / g / ml / l / pieces). May differ from
  // `unit` when the line was stored as a pack count ("packs" / "bottles").
  nativeUnit?: string | null;
  /** What one pack is called (#327). */
  packName?: string | null;
  useByDate: string;
  shelfLifeDays: number | null;
  requiresUseByDate: boolean;
  defaultStorageLocation: string | null;
  useByIsAuto: boolean;
  /** Received (at quantityReceived) / Not received / not decided yet. Every
   *  line must be decided before goods-in can be completed (lib/goods-in). */
  decision: LineDecision;
  stockInPacks?: boolean;
  packWeight?: number | null;
  palletSize?: number | null;
  /** Minimum shelf life on delivery, days (null = none). */
  minDeliveryShelfLifeDays: number | null;
  /** "Accept anyway" tapped on a short-shelf-life warning. */
  shelfLifeAccepted: boolean;
  /** "Reject it" tapped: the use-by that was too short (line is Not received). */
  shelfLifeRejectedUseBy: string | null;
  /** This line's shelf life was already reported on an earlier save. */
  shelfLifeReported: boolean;
  /** "Damaged / broken" (quantityReceived = what ARRIVED; a rejected damaged
   *  quantity is taken off when sent — receivedAfterDamage). */
  damage: LineDamage | null;
  /** The damage was already reported on an earlier save (read-only now). */
  damageReported: boolean;
}

type ShelfLifeRecord = Parameters<typeof ShelfLifeRecordNote>[0]["record"];
type DamageRecord = Parameters<typeof DamageRecordNote>[0]["record"] & { disposition: string };

const TONE_CLASS: Record<RowTone, string> = {
  not_received: "border-red-400 bg-red-50/60 dark:bg-red-950/20 dark:border-red-800",
  shelf_life_short: "border-red-600 bg-red-50/40 dark:bg-red-950/20",
  use_by_missing: "border-destructive bg-destructive/5",
  discrepancy: "border-amber-400 bg-amber-50/40 dark:bg-amber-900/10 dark:border-amber-700",
  received: "border-green-400 bg-green-50/60 dark:bg-green-900/15 dark:border-green-700",
  undecided: "border-dashed border-amber-400 bg-background",
};

/** The two column layouts, as CSS variables for the list that holds the
 *  header and rows: tablet and wide screens. */
export function receivingColumnVars(anyUseBy: boolean): CSSProperties {
  return {
    "--recv-cols-md": receivingColumns({ anyUseBy, wide: false }),
    "--recv-cols-lg": receivingColumns({ anyUseBy, wide: true }),
  } as CSSProperties;
}

/** Column titles over the rows (tablet and desktop only). */
export function ReceivingColumnHeader({ anyUseBy }: { anyUseBy: boolean }) {
  const cell = "text-xs font-semibold text-muted-foreground";
  return (
    <div className="hidden md:grid md:[grid-template-columns:var(--recv-cols-md)] lg:[grid-template-columns:var(--recv-cols-lg)] gap-x-1.5 items-end px-3 py-1">
      <span className={cell}>Arrived?</span>
      <span className={cell}>Ordered · item</span>
      <span className={cn(cell, "text-center")}>Received</span>
      {anyUseBy && <span className={cell}>Use-by</span>}
      <span className={cn(cell, "text-center")}>Damaged</span>
    </div>
  );
}

export function ReceivingLineRow({
  line,
  onChange,
  supplierName,
  deliveryDay,
  anyUseBy,
  slRecord,
  dmRecord,
}: {
  line: ReceivingLine;
  /** Applies a change to this line only. */
  onChange: (patch: Partial<ReceivingLine>) => void;
  supplierName: string;
  /** London day shelf life is counted from. */
  deliveryDay: string;
  /** Some line on the order has a use-by column. */
  anyUseBy: boolean;
  slRecord?: ShelfLifeRecord;
  dmRecord?: DamageRecord;
}) {
  const received = line.decision === "received";
  const notReceived = line.decision === "not_received";
  const discrepancy = received && line.quantityReceived !== line.quantityOrdered;
  const useByMissing = received && line.requiresUseByDate && line.quantityReceived > 0 && !line.useByDate;
  const slCheck = checkShelfLife({ deliveryDate: deliveryDay, useByDate: line.useByDate, minDays: line.minDeliveryShelfLifeDays });
  const slShort = received && line.quantityReceived > 0 && !!slCheck?.short;
  const rejectedCheck = notReceived && line.shelfLifeRejectedUseBy
    ? checkShelfLife({ deliveryDate: deliveryDay, useByDate: line.shelfLifeRejectedUseBy, minDays: line.minDeliveryShelfLifeDays })
    : null;
  const showUseBy = line.requiresUseByDate || line.minDeliveryShelfLifeDays != null;
  const tone = rowTone({
    decision: line.decision,
    quantityOrdered: line.quantityOrdered,
    quantityReceived: line.quantityReceived,
    shelfLifeShort: slShort,
    requiresUseByDate: line.requiresUseByDate,
    useByDate: line.useByDate,
  });

  const qty = rowQuantity(line);
  const native = line.nativeUnit ?? line.unit;
  const sizeHint = qty.inPacks ? packSizeHint(line.packWeight, native, line.packName) : null;
  const pallet = palletReceiptLabel(line.quantityOrdered, line.unit, {
    packWeight: line.packWeight,
    palletSize: line.palletSize,
    unit: native,
  });
  const orderedText = qty.inPacks
    ? `${qty.orderedPacks} ${packNoun(native, qty.orderedPacks, line.packName)}`
    : `${line.quantityOrdered} ${line.unit}`;
  const receivedUnit = qty.inPacks ? packNoun(native, qty.receivedShown || 0, line.packName) : line.unit;

  const decide = (decision: LineDecision) => {
    // Received with nothing in the box means the ordered amount.
    const q = decision === "received" && !(line.quantityReceived > 0) ? line.quantityOrdered : line.quantityReceived;
    // A plain Received / Not received tap undoes any shelf-life call.
    onChange({
      decision, quantityReceived: q, shelfLifeAccepted: false, shelfLifeRejectedUseBy: null,
      // Nothing arrived = nothing damaged (unless already reported).
      damage: decision === "not_received" && !line.damageReported ? null : line.damage,
    });
  };
  const setStored = (stored: number) => onChange({ quantityReceived: stored, decision: decisionForQuantity(stored) });

  const canMarkDamage = !dmRecord && received && line.quantityReceived > 0;
  const hasDetails = !!slRecord || (notReceived && !!line.shelfLifeRejectedUseBy) || (slShort && !!slCheck)
    || !!dmRecord || (canMarkDamage && !!line.damage);

  const chip = "text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1";

  return (
    <div
      className={cn(
        "rounded-xl border-2 px-2 py-1 md:py-0.5 transition-colors flex flex-wrap items-center gap-2 md:grid md:[grid-template-columns:var(--recv-cols-md)] lg:[grid-template-columns:var(--recv-cols-lg)] md:gap-x-1.5 md:gap-y-2",
        TONE_CLASS[tone],
      )}
    >
      {/* Every line is decided (Graeme, 2026-10-15): Received at the quantity
          shown — edit it for a short delivery — or Not received. */}
      <div className="flex gap-6 shrink-0" role="group" aria-label={`${line.ingredientName}: received or not`}>
        <button
          type="button"
          onClick={() => decide("received")}
          aria-pressed={received}
          aria-label={`${line.ingredientName}: received`}
          title="Received"
          className={cn(
            "h-11 w-11 rounded-xl border-2 inline-flex items-center justify-center transition-colors",
            received
              ? "bg-green-600 border-green-600 text-white"
              : "border-green-500 text-green-700 dark:text-green-300 bg-background hover:bg-green-50 dark:hover:bg-green-900/20",
          )}
        >
          <Check className="w-6 h-6" strokeWidth={3} />
        </button>
        <button
          type="button"
          onClick={() => decide("not_received")}
          aria-pressed={notReceived}
          aria-label={`${line.ingredientName}: not received`}
          title="Not received"
          className={cn(
            "h-11 w-11 rounded-xl border-2 inline-flex items-center justify-center transition-colors",
            notReceived
              ? "bg-red-600 border-red-600 text-white"
              : "border-red-400 text-red-600 dark:text-red-300 bg-background hover:bg-red-50 dark:hover:bg-red-900/20",
          )}
        >
          <X className="w-6 h-6" strokeWidth={3} />
        </button>
      </div>

      {/* "8 bottles  Whole Milk": what was ordered first, then the name —
          the quantity in its own box so the names still stand apart.
          Name never truncated — it wraps. */}
      <div className="flex-1 min-w-[10rem] md:min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <span className={cn(
            "shrink-0 rounded-md px-2 py-0.5 text-base md:text-lg font-bold tabular-nums leading-tight whitespace-nowrap",
            notReceived ? "bg-red-100 border border-red-200 text-red-800 dark:bg-red-950/40 dark:border-red-900 dark:text-red-300" : "bg-background border border-border text-foreground",
          )}>
            {orderedText}
          </span>
          <span className={cn("text-base md:text-lg font-bold leading-tight break-words min-w-0", notReceived && "text-red-800 dark:text-red-300")}>
            {line.ingredientName}
          </span>
        </div>
        {/* One line under it: pack size, pallet, then any flags. */}
        {(sizeHint || pallet || useByMissing || (line.useByIsAuto && !notReceived) || discrepancy) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {(sizeHint || pallet) && (
              <span className="text-sm text-muted-foreground leading-snug">
                {sizeHint && <>({sizeHint})</>}
                {sizeHint && pallet && " · "}
                {/* Pallet orders: "1 pallet — 50 packs" so the person at the
                    door can match it to what's on the truck. */}
                {pallet && <span className="font-semibold">{pallet}</span>}
              </span>
            )}
            {useByMissing && (
              <span className={cn(chip, "font-medium text-destructive bg-destructive/10")}>
                <AlertTriangle className="w-3 h-3" /> Use-by required
              </span>
            )}
            {line.useByIsAuto && !notReceived && (
              <span className={cn(chip, "font-medium text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30")}>Auto-dated</span>
            )}
            {discrepancy && (
              <span className={cn(chip, "font-medium text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30")}>
                <AlertTriangle className="w-3 h-3" />
                {line.quantityReceived < line.quantityOrdered ? "Short — goes on the short-delivery report" : "More than ordered"}
              </span>
            )}
          </div>
        )}
      </div>

      {notReceived ? (
        <p className={cn("text-sm font-semibold text-red-800 dark:text-red-300 basis-full md:basis-auto", anyUseBy && "md:col-span-2")}>
          Nothing {line.shelfLifeRejectedUseBy ? "kept" : "arrived"} — it goes on the short-delivery report.
        </p>
      ) : (
        <>
          {/* Received stepper — the unit sits under the number. */}
          <div className={cn(
            "flex items-stretch h-11 rounded-lg border bg-background overflow-hidden focus-within:ring-2 focus-within:ring-primary/30 w-[11rem] md:w-full",
            discrepancy ? "border-amber-400" : "border-border",
          )}>
            <button
              type="button"
              aria-label={qty.inPacks ? "Decrease received by 1 pack" : "Decrease received by 0.5"}
              onClick={() => setStored(qty.storedAfterStep(-qty.step))}
              className="w-11 bg-secondary/40 hover:bg-secondary/70 active:bg-secondary text-foreground transition-colors flex items-center justify-center shrink-0"
            >
              <Minus className="w-5 h-5" />
            </button>
            <label className="flex-1 min-w-0 flex flex-col items-center justify-center leading-none">
              <NumberInput
                step={qty.step}
                min="0"
                inputMode={qty.inPacks ? "numeric" : "decimal"}
                aria-label={`${line.ingredientName}: received (${receivedUnit})`}
                value={qty.inPacks ? qty.receivedShown : line.quantityReceived}
                onChange={(n) => setStored(qty.storedFromTyped(n))}
                className="w-full min-w-0 px-1 bg-transparent text-center text-lg font-bold tabular-nums text-[#7cb342] focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-[11px] font-medium text-muted-foreground truncate max-w-full px-1">{receivedUnit}</span>
            </label>
            <button
              type="button"
              aria-label={qty.inPacks ? "Increase received by 1 pack" : "Increase received by 0.5"}
              onClick={() => setStored(qty.storedAfterStep(qty.step))}
              className="w-11 bg-secondary/40 hover:bg-secondary/70 active:bg-secondary text-foreground transition-colors flex items-center justify-center shrink-0"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>

          {/* Use-by — only lines that need one; an empty cell keeps the
              columns lined up. */}
          {showUseBy ? (
            <label className="min-w-0 flex items-center gap-1">
              <span className="md:hidden text-xs font-semibold text-muted-foreground">
                Use-by{line.requiresUseByDate && <span className="text-destructive ml-0.5">*</span>}
              </span>
              <input
                type="date"
                aria-label={`${line.ingredientName}: use-by date${line.requiresUseByDate ? " (required)" : ""}`}
                value={line.useByDate}
                // A new date needs a new shelf-life decision.
                onChange={(e) => onChange({ useByDate: e.target.value, useByIsAuto: false, shelfLifeAccepted: false })}
                className={cn(
                  "w-full min-w-0 h-11 px-2 bg-background border rounded-lg text-base font-bold focus:outline-none focus:ring-2 focus:ring-primary/30",
                  useByMissing || slShort ? "border-destructive border-2" : "border-border",
                )}
              />
            </label>
          ) : anyUseBy ? (
            <div className="hidden md:block" />
          ) : null}
        </>
      )}

      {/* Damaged / broken — opens the damage panel under this row only. */}
      {canMarkDamage ? (
        <button
          type="button"
          onClick={() => onChange({ damage: line.damage ? null : { quantity: line.quantityReceived, disposition: null, note: "" } })}
          aria-pressed={!!line.damage}
          aria-label={line.damage ? `${line.ingredientName}: not damaged` : `${line.ingredientName}: damaged / broken?`}
          title={line.damage ? "Not damaged" : "Damaged / broken?"}
          className={cn(
            "h-11 w-11 md:w-full rounded-xl border-2 inline-flex items-center justify-center transition-colors shrink-0",
            line.damage
              ? "bg-orange-500 border-orange-500 text-white"
              : "border-dashed border-orange-500 text-orange-700 dark:text-orange-300 bg-background hover:bg-orange-50 dark:hover:bg-orange-950/20",
          )}
        >
          <PackageX className="w-5 h-5" />
        </button>
      ) : (
        <div className="hidden md:block" />
      )}

      {hasDetails && (
        <div className="basis-full md:col-span-full space-y-2 min-w-0">
          {slRecord && <ShelfLifeRecordNote record={slRecord} supplierName={supplierName} />}
          {notReceived && line.shelfLifeRejectedUseBy && (
            <ShelfLifeRejectedNote
              check={rejectedCheck}
              useByDate={line.shelfLifeRejectedUseBy}
              supplierName={supplierName}
              alreadyReported={line.shelfLifeReported}
            />
          )}
          {slShort && slCheck && (
            <ShelfLifeWarning
              check={slCheck}
              supplierName={supplierName}
              accepted={line.shelfLifeAccepted}
              onAccept={() => onChange({ shelfLifeAccepted: true, shelfLifeRejectedUseBy: null })}
              onReject={() => onChange({ decision: "not_received", shelfLifeAccepted: false, shelfLifeRejectedUseBy: line.useByDate })}
              onUndo={() => onChange({ shelfLifeAccepted: false })}
            />
          )}
          {dmRecord ? (
            <DamageRecordNote record={dmRecord} supplierName={supplierName} unitLabel={line.unit} />
          ) : canMarkDamage && line.damage ? (
            <DamagePanel
              line={line}
              arrived={line.quantityReceived}
              damage={line.damage}
              onChange={(d) => onChange({ damage: d })}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
