/**
 * The plan checks on one row (Graeme, 16 Oct 2026: "we now have to scroll
 * vertically because of the slow-meat, covers-orders and predicted-factory
 * checks — combine them on one row on desktop, three separate panels side by
 * side. Hide the explanatory text by default — click the panel to show how
 * it's worked out."). Objective A.
 *
 * Three compact tiles across when the recipe column is wide (container query,
 * so it follows the column, not the screen); stacked on iPad portrait and
 * phone. Tapping a tile — or its Change … button — opens that tile's details
 * full width under the row, so the row itself never reflows. One open at a
 * time.
 */
import { useState } from "react";
import type { MarginWarning, PlanMarginSettings } from "@workspace/plan-margin";
import type { FactoryRecommendation } from "@workspace/stock-prediction";
import { CheckDetails } from "@/components/check-tile";
import { SlowMeatDetails, SlowMeatTile, slowMeatTone } from "@/components/slow-meat-panel";
import { PlanMarginDetails, PlanMarginTile, marginTone } from "@/components/plan-margin-panel";
import { FactoryForecastDetails, FactoryForecastTile, type PlanFactoryForecastState } from "@/components/factory-forecast-panel";
import type { CappablePlanRow, SlowMeatProfileData } from "@/lib/slow-meat-plan";
import { cn } from "@/lib/utils";

type Key = "slow" | "margin" | "factory";

export function PlanChecksRow({ slowMeat, margin, factory }: {
  /** Create Plan only — the Edit Plan screen has no slow-meat check. */
  slowMeat?: { rows: CappablePlanRow[]; data: SlowMeatProfileData | undefined; loadError: boolean; isAdmin: boolean };
  margin: {
    warnings: MarginWarning[];
    settings: PlanMarginSettings;
    canEdit: boolean;
    onAddBatches: (rowId: string, batches: number) => void;
    onFixAll: () => void;
  };
  factory: { state: PlanFactoryForecastState; canEdit: boolean; onApply: (rec: FactoryRecommendation) => void };
}) {
  const [open, setOpen] = useState<Key | null>(null);
  const [editing, setEditing] = useState(false);
  const toggle = (k: Key) => { setEditing(false); setOpen(o => (o === k ? null : k)); };
  const edit = (k: Key) => {
    setEditing(e => (open === k ? !e : true));
    setOpen(k);
  };
  const close = () => { setOpen(null); setEditing(false); };

  return (
    <div className="@container mb-3 space-y-3">
      <div className={cn("grid gap-3 grid-cols-1 items-stretch", slowMeat ? "@3xl:grid-cols-3" : "@2xl:grid-cols-2")}>
        {slowMeat && (
          <SlowMeatTile {...slowMeat} expanded={open === "slow"} onToggle={() => toggle("slow")} onEdit={() => edit("slow")} />
        )}
        <PlanMarginTile
          warnings={margin.warnings} canEdit={margin.canEdit} onFixAll={margin.onFixAll}
          expanded={open === "margin"} onToggle={() => toggle("margin")} onEdit={() => edit("margin")}
        />
        <FactoryForecastTile
          state={factory.state} canEdit={factory.canEdit} onApply={factory.onApply}
          expanded={open === "factory"} onToggle={() => toggle("factory")} onEdit={() => edit("factory")}
        />
      </div>

      {open === "slow" && slowMeat && (
        <CheckDetails tone={slowMeatTone(slowMeat.rows, slowMeat.data, slowMeat.loadError)} title="Slow meat — how it's worked out" onClose={close}>
          <SlowMeatDetails {...slowMeat} editing={editing} />
        </CheckDetails>
      )}
      {open === "margin" && (
        <CheckDetails tone={marginTone(margin.warnings)} title="Orders + margin — how it's worked out" onClose={close}>
          <PlanMarginDetails
            warnings={margin.warnings} settings={margin.settings} canEdit={margin.canEdit}
            editing={editing} onAddBatches={margin.onAddBatches}
          />
        </CheckDetails>
      )}
      {open === "factory" && (
        <CheckDetails tone="neutral" title="Predicted factory number — how it's worked out" onClose={close}>
          <FactoryForecastDetails state={factory.state} canEdit={factory.canEdit} editing={editing} />
        </CheckDetails>
      )}
    </div>
  );
}
