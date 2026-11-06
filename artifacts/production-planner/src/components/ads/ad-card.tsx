/**
 * One campaign, ad set or ad: its name on a bar in its colour, like a Numbers
 * panel, with the three figures in their own colours below. Tap for the rest.
 */
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { money, penceText, roasText, type AdGrade, type AdRow } from "@/lib/ads-page";
import type { RoasShade } from "@/lib/ad-efficiency";

const shadeText = (shade: RoasShade) => (shade.darkBackground ? "text-white" : "text-stone-900");

function Figure({ label, value, shade }: { label: string; value: string; shade: RoasShade | null }) {
  return (
    <div
      className={cn("px-0.5 py-2 text-center min-w-0", shade ? shadeText(shade) : "bg-secondary/60 text-foreground")}
      style={shade ? { backgroundColor: shade.hex } : undefined}
    >
      <p className="text-[11px] font-medium opacity-90">{label}</p>
      <p className="text-[13px] font-bold tabular-nums tracking-tight">{value}</p>
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
  const parent = row.level === "ad" ? row.adSetName : row.campaignName;
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
        {parent && <p className="text-xs font-medium opacity-90 mt-0.5 break-words">{parent}</p>}
        {grade.note && <p className="text-sm font-semibold opacity-90 mt-0.5">{grade.note}</p>}
      </div>
      <div className="grid grid-cols-3 gap-px bg-border">
        <Figure label="CPA" value={money(row.costPerResult)} shade={grade.costPerResult} />
        <Figure label="ROAS" value={roasText(row.roas)} shade={grade.roas} />
        <Figure label="Reach" value={penceText(row.costPerReachPence)} shade={grade.costPerReach} />
      </div>
    </div>
  );
}
