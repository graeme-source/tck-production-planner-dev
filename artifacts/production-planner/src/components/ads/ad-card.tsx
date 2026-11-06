/**
 * One campaign, ad set or ad: its name on a bar in its colour, like a Numbers
 * panel, with the four figures on plain card below (Graeme, 6 Nov 2026: fully
 * coloured cards were too much and hard to read). A small dot gives each
 * targeted figure's own colour. Tap for the rest.
 */
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { money, reachPctText, roasText, type AdGrade, type AdRow } from "@/lib/ads-page";
import type { RoasShade } from "@/lib/ad-efficiency";

const shadeText = (shade: RoasShade) => (shade.darkBackground ? "text-white" : "text-stone-900");

function Figure({ label, value, shade = null }: { label: string; value: string; shade?: RoasShade | null }) {
  return (
    <div className="bg-card px-0.5 py-2 text-center min-w-0">
      <p className="text-[11px] font-medium text-muted-foreground inline-flex items-center gap-1">
        {shade && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: shade.hex }} />}
        {label}
      </p>
      <p className="text-[13px] font-bold tabular-nums tracking-tight text-foreground">{value}</p>
    </div>
  );
}

export function AdCard({ row, grade, canEdit, onOpen, onEditTargets }: {
  row: AdRow;
  grade: AdGrade;
  canEdit: boolean;
  onOpen: () => void;
  onEditTargets: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
      className="rounded-2xl overflow-hidden border border-border bg-card shadow-sm cursor-pointer hover:shadow-md transition-shadow text-left"
    >
      <div
        className={cn("px-4 py-3", grade.overall ? shadeText(grade.overall) : "bg-secondary text-foreground")}
        style={grade.overall ? { backgroundColor: grade.overall.hex } : undefined}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="font-display font-bold leading-snug break-words min-w-0">{row.name}</p>
          {canEdit && (
            // A span, not a button: the whole card is one.
            <span
              role="button"
              tabIndex={0}
              aria-label="Change the ads targets"
              onClick={(e) => { e.stopPropagation(); onEditTargets(); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onEditTargets(); } }}
              className="p-1 -m-1 rounded hover:bg-black/10 cursor-pointer flex-shrink-0"
            >
              <Pencil className="w-4 h-4" />
            </span>
          )}
        </div>
        {grade.note && <p className="text-sm font-semibold opacity-90 mt-0.5">{grade.note}</p>}
      </div>
      {/* Four across where the columns are wide; two by two on an iPad, where
          four would clip the figures. */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-px bg-border border-t border-border">
        <Figure label="CPA" value={money(row.costPerResult)} shade={grade.costPerResult} />
        <Figure label="Spend" value={money(row.spend)} />
        <Figure label="ROAS" value={roasText(row.roas)} shade={grade.roas} />
        <Figure label="Reach" value={reachPctText(row.costPerReachPct)} shade={grade.costPerReach} />
      </div>
    </div>
  );
}
