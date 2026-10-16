/**
 * Production safety margin on the Create / Edit Plan screens (Graeme,
 * 15 Oct 2026 — three test products were planned at or under their orders,
 * one batch came out 2 packs light, and orders had to be cancelled).
 * Objective C.
 *
 *   PlanMarginTile        compact check tile (one of three in a row since
 *                         16 Oct 2026): "Every recipe covers orders +
 *                         margin ✓", or how many are short / too close, with
 *                         one "Add N batches" fix-all and Change margin
 *   PlanMarginDetails     opened by tapping the tile: every recipe that is
 *                         short or inside the margin, each with a one-tap
 *                         "Add N batches"; managers' margin numbers
 *                         (autosaved); the rule in words
 *   RowMarginNote         a compact line under a recipe's Batches box
 *   MarginSaveGuard       the summary shown when Save is tapped with any
 *                         recipe short / under the margin — saving anyway
 *                         takes a second, deliberate tap
 *
 * The rule and the wording live in @workspace/plan-margin (tested); the rows
 * are mapped in lib/plan-margin-rows.ts from the table's own D2 + D3 figures.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Plus, Settings2, ShieldAlert } from "lucide-react";
import type { MarginCheck, MarginWarning, PlanMarginSettings } from "@workspace/plan-margin";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { CheckTile, TileButton, type CheckTone } from "@/components/check-tile";
import { PLAN_MARGIN_KEY, savePlanMargin } from "@/hooks/use-plan-margin";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function ruleText(s: PlanMarginSettings): string {
  return `Every recipe with orders is planned to at least ${plural(s.smallMarginPacks, "spare pack")} over its orders (${plural(s.largeMarginPacks, "pack")} when the orders need more than ${plural(s.largeBatchThreshold, "batch", "batches")}).`;
}

export function marginTone(warnings: MarginWarning[]): CheckTone {
  if (warnings.length === 0) return "ok";
  return warnings.some(w => w.check.status === "short") ? "red" : "amber";
}

export function PlanMarginTile({ warnings, canEdit, expanded, onToggle, onEdit, onFixAll }: {
  warnings: MarginWarning[];
  canEdit: boolean;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onFixAll: () => void;
}) {
  const shortCount = warnings.filter(w => w.check.status === "short").length;
  const tone = marginTone(warnings);
  const toAdd = warnings.reduce((s, w) => s + w.check.batchesToAdd, 0);
  return (
    <CheckTile
      tone={tone} expanded={expanded} onToggle={onToggle} label="Orders + margin"
      icon={tone === "ok"
        ? <CheckCircle2 className="w-6 h-6 text-emerald-600" />
        : <ShieldAlert className={cn("w-6 h-6", tone === "red" ? "text-red-600" : "text-amber-600")} />}
      headline={tone === "ok"
        ? "Every recipe covers orders + margin ✓"
        : shortCount > 0
          ? `${plural(shortCount, "recipe")} short of orders`
          : `${plural(warnings.length, "recipe")} too close to the line`}
      sub={shortCount > 0 && warnings.length > shortCount ? `+ ${warnings.length - shortCount} inside the margin` : undefined}
      actions={(warnings.length > 0 || canEdit) ? (
        <>
          {warnings.length > 0 && (
            <TileButton primary onClick={onFixAll}><Plus className="w-4 h-4" /> Add {plural(toAdd, "batch", "batches")}</TileButton>
          )}
          {canEdit && <TileButton onClick={onEdit}><Settings2 className="w-4 h-4" /> Change margin</TileButton>}
        </>
      ) : undefined}
    />
  );
}

export function PlanMarginDetails({ warnings, settings, canEdit, editing, onAddBatches }: {
  warnings: MarginWarning[];
  settings: PlanMarginSettings;
  canEdit: boolean;
  editing: boolean;
  onAddBatches: (rowId: string, batches: number) => void;
}) {
  return (
    <div className="space-y-3">
      {warnings.length > 0 && (
        <ul className="grid gap-2 grid-cols-1 xl:grid-cols-2">
          {warnings.map(w => (
            <MarginWarningCard key={w.key} warning={w} onAdd={() => onAddBatches(w.key, w.check.batchesToAdd)} />
          ))}
        </ul>
      )}

      {editing && canEdit && <PlanMarginSettingsEditor settings={settings} />}

      <p className="text-sm text-muted-foreground">
        {ruleText(settings)} Orders = the D2 + D3 dispatch columns; stock = the factory number at the start of the plan day.
      </p>
    </div>
  );
}

function MarginWarningCard({ warning, onAdd }: { warning: MarginWarning; onAdd: () => void }) {
  const short = warning.check.status === "short";
  return (
    <li className={cn(
      "flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 bg-background",
      short ? "border-red-400" : "border-amber-400",
    )}>
      <div className="min-w-0 flex-1">
        <div className="font-bold text-base">{warning.recipeName}</div>
        <div className={cn("text-sm", short ? "text-red-700 dark:text-red-300 font-semibold" : "text-amber-900 dark:text-amber-200")}>
          {warning.message}
        </div>
      </div>
      <button
        type="button"
        onClick={onAdd}
        className={cn(
          "inline-flex items-center gap-1.5 h-11 px-4 rounded-xl text-sm font-bold text-white",
          short ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700",
        )}
      >
        <Plus className="w-4 h-4" /> Add {plural(warning.check.batchesToAdd, "batch", "batches")}
      </button>
    </li>
  );
}

/** Compact note under a recipe's Batches box, with the same one-tap fix. */
export function RowMarginNote({ check, onAdd }: { check: MarginCheck; onAdd: () => void }) {
  if (check.status !== "short" && check.status !== "under-margin") return null;
  const short = check.status === "short";
  return (
    <div className={cn("mt-1 text-[10px] leading-tight font-semibold", short ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400")}>
      <div title={`Orders ${check.demandPacks} + ${check.marginPacks} margin = ${check.requiredPacks}; you'll have ${check.availablePacks}`}>
        {short ? "Short" : "Tight"}: need {check.requiredPacks}, have {check.availablePacks}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className={cn("mt-0.5 px-1.5 py-0.5 rounded-md text-white text-[10px] font-bold", short ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700")}
      >
        +{plural(check.batchesToAdd, "batch", "batches")}
      </button>
    </div>
  );
}

/** Shown when Save is tapped while any recipe is short or inside the margin.
 *  "Add the batches and save" fixes everything in one tap; saving as it is
 *  needs the separate, deliberately worded second button. */
export function MarginSaveGuard({ open, warnings, saving, onFixAndSave, onSaveAnyway, onClose }: {
  open: boolean;
  warnings: MarginWarning[];
  saving: boolean;
  onFixAndSave: () => void;
  onSaveAnyway: () => void;
  onClose: () => void;
}) {
  const shortCount = warnings.filter(w => w.check.status === "short").length;
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      {/* Built-in X closes it; the card is capped and the list scrolls inside. */}
      <DialogContent className="max-w-2xl w-[calc(100vw-1.5rem)] max-h-[92dvh] p-0 gap-0 flex flex-col border-2 border-red-500 rounded-2xl">
        <DialogHeader className="p-5 pb-3 pr-12 text-left">
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0" />
            {shortCount > 0 ? "This plan won't cover all the orders" : "This plan has no safety margin on some recipes"}
          </DialogTitle>
          <DialogDescription>
            One short batch and orders get cancelled. Add the batches, or save as it is if you're sure.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex-1 min-h-0 overflow-y-auto px-5 space-y-2">
          {warnings.map(w => (
            <li key={w.key} className={cn("rounded-xl border px-3 py-2.5", w.check.status === "short" ? "border-red-400 bg-red-500/5" : "border-amber-400 bg-amber-500/5")}>
              <div className="font-bold">{w.recipeName}</div>
              <div className="text-sm">{w.message}</div>
            </li>
          ))}
        </ul>
        <div className="p-5 pt-4 flex flex-col sm:flex-row gap-2 border-t border-border mt-3">
          <button
            type="button"
            disabled={saving}
            onClick={onFixAndSave}
            className="flex-1 h-12 rounded-xl bg-primary text-primary-foreground text-base font-bold hover:bg-primary/90 disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            <Plus className="w-5 h-5" /> Add the batches and save
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onSaveAnyway}
            className="flex-1 h-12 rounded-xl border-2 border-red-500 text-red-700 dark:text-red-300 text-sm font-bold hover:bg-red-500/10 disabled:opacity-50"
          >
            Save anyway — {shortCount > 0 ? `${plural(shortCount, "recipe")} short` : "no margin"}
          </button>
          <button type="button" onClick={onClose} className="h-12 px-4 rounded-xl border border-border text-sm font-semibold hover:bg-secondary/60">
            Go back
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PlanMarginSettingsEditor({ settings }: { settings: PlanMarginSettings }) {
  const queryClient = useQueryClient();
  const [small, setSmall] = useState(String(settings.smallMarginPacks));
  const [large, setLarge] = useState(String(settings.largeMarginPacks));
  const [threshold, setThreshold] = useState(String(settings.largeBatchThreshold));
  const auto = useAutosave(async (next: PlanMarginSettings) => {
    await savePlanMargin(next);
    await queryClient.invalidateQueries({ queryKey: PLAN_MARGIN_KEY });
    // The server's suggestions use the margin too.
    await queryClient.invalidateQueries({ queryKey: ["production-plan-calculate"] });
  });
  const schedule = (a: string, b: string, c: string) => {
    const vals = [a, b, c].map(v => Number(v));
    if ([a, b, c].some(v => v.trim() === "") || vals.some(v => !Number.isInteger(v) || v < 0)) return;
    auto.schedule({ smallMarginPacks: vals[0], largeMarginPacks: vals[1], largeBatchThreshold: vals[2] });
  };
  const field = "h-12 w-24 rounded-xl border-2 border-border bg-background px-3 text-lg font-bold tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-primary/40";
  return (
    <div className="flex flex-wrap items-end gap-4 pt-1">
      <label className="space-y-1">
        <span className="block text-sm font-semibold text-muted-foreground">Spare packs (normal)</span>
        <input type="number" min={0} inputMode="numeric" value={small} className={field}
          onChange={e => { setSmall(e.target.value); schedule(e.target.value, large, threshold); }}
          onBlur={() => void auto.flush()} />
      </label>
      <label className="space-y-1">
        <span className="block text-sm font-semibold text-muted-foreground">Spare packs (big orders)</span>
        <input type="number" min={0} inputMode="numeric" value={large} className={field}
          onChange={e => { setLarge(e.target.value); schedule(small, e.target.value, threshold); }}
          onBlur={() => void auto.flush()} />
      </label>
      <label className="space-y-1">
        <span className="block text-sm font-semibold text-muted-foreground">Big = orders need more than (batches)</span>
        <input type="number" min={0} inputMode="numeric" value={threshold} className={field}
          onChange={e => { setThreshold(e.target.value); schedule(small, large, e.target.value); }}
          onBlur={() => void auto.flush()} />
      </label>
      <div className="pb-3"><SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} /></div>
    </div>
  );
}
