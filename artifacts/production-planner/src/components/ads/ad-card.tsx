/**
 * One campaign, ad set or ad: its name on a bar in its colour, like a Numbers
 * panel, with the four figures on plain card below (Graeme, 6 Nov 2026: fully
 * coloured cards were too much and hard to read). A small dot gives each
 * targeted figure's own colour. Tap for the rest.
 *
 * Sized by level so the cascade reads at a glance (Graeme, 12 Nov 2026): a
 * campaign is three times an ad's height, an ad set twice, and the figures
 * step down the same way — campaign biggest, ad the smallest.
 */
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { money, reachPctText, roasText, type AdGrade, type AdRow } from "@/lib/ads-page";
import type { RoasShade } from "@/lib/ad-efficiency";

const shadeText = (shade: RoasShade) => (shade.darkBackground ? "text-white" : "text-stone-900");

export type AdLevel = "campaign" | "adSet" | "ad";

/** Per level: the card's height (3× / 2× / 1× an ad's), the name, and the
 *  figures. An ad is exactly as it was before. */
const LEVEL: Record<AdLevel, { card: string; name: string; note: string; label: string; value: string; dot: string }> = {
  campaign: {
    card: "min-h-[29rem] xl:min-h-[19rem]",
    name: "text-xl xl:text-2xl",
    note: "text-base",
    label: "text-sm xl:text-[15px]",
    value: "text-2xl xl:text-[26px]",
    dot: "w-3 h-3",
  },
  adSet: {
    card: "min-h-[19rem] xl:min-h-[12.5rem]",
    name: "text-lg",
    note: "text-sm",
    label: "text-xs xl:text-[13px]",
    value: "text-lg xl:text-xl",
    dot: "w-2.5 h-2.5",
  },
  ad: { card: "", name: "", note: "text-sm", label: "text-[11px]", value: "text-[13px]", dot: "w-2 h-2" },
};

function Figure({ label, value, shade = null, level }: { label: string; value: string; shade?: RoasShade | null; level: AdLevel }) {
  const l = LEVEL[level];
  return (
    <div className="bg-card px-0.5 py-2 text-center min-w-0 flex flex-col items-center justify-center">
      <p className={cn("font-medium text-muted-foreground inline-flex items-center gap-1", l.label)}>
        {shade && <span className={cn("rounded-full flex-shrink-0", l.dot)} style={{ backgroundColor: shade.hex }} />}
        {label}
      </p>
      <p className={cn("font-bold tabular-nums tracking-tight text-foreground", l.value)}>{value}</p>
    </div>
  );
}

export function AdCard({ row, grade, canEdit, onOpen, onEditTargets, level = "ad" }: {
  row: AdRow;
  /** Campaign, ad set or ad: sets the card's height and text sizes. */
  level?: AdLevel;
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
      className={cn("rounded-2xl overflow-hidden border border-border bg-card shadow-sm cursor-pointer hover:shadow-md transition-shadow text-left flex flex-col", LEVEL[level].card)}
    >
      <div
        className={cn("px-4 py-3", grade.overall ? shadeText(grade.overall) : "bg-secondary text-foreground")}
        style={grade.overall ? { backgroundColor: grade.overall.hex } : undefined}
      >
        <div className="flex items-start justify-between gap-2">
          <p className={cn("font-display font-bold leading-snug break-words min-w-0", LEVEL[level].name)}>{row.name}</p>
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
        {grade.note && <p className={cn("font-semibold opacity-90 mt-0.5", LEVEL[level].note)}>{grade.note}</p>}
      </div>
      {/* Four across where the columns are wide; two by two on an iPad, where
          four would clip the figures. */}
      {/* The figures take the extra height on a taller card. */}
      <div className="flex-1 grid grid-cols-2 xl:grid-cols-4 gap-px bg-border border-t border-border">
        <Figure level={level} label="CPA" value={money(row.costPerResult)} shade={grade.costPerResult} />
        <Figure level={level} label="Spend" value={money(row.spend)} />
        <Figure level={level} label="ROAS" value={roasText(row.roas)} shade={grade.roas} />
        <Figure level={level} label="Reach" value={reachPctText(row.costPerReachPct)} shade={grade.costPerReach} />
      </div>
    </div>
  );
}
