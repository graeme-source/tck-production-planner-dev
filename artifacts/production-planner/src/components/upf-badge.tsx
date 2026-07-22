/**
 * UPF display atoms, shared by the Recipes, Sub-Recipes and Ingredients
 * pages.
 *
 * An ingredient's NOVA class (1-4) comes from the AI classification (or a
 * manual override) stored on the ingredient. NOVA 4 = ultra-processed
 * (UPF) — those get the red chip. Recipes/sub-recipes show a UPF
 * percentage-by-weight pill rolled up server-side (GET /api/upf/summary).
 */

/** Red "UPF" chip on a NOVA-4 ingredient; nothing for classes 1-3.
 *  Hover shows the marker ingredients that made it UPF. */
export function UpfChip({ novaClass, markers, className }: { novaClass?: number | null; markers?: string[] | null; className?: string }) {
  if (novaClass !== 4) return null;
  const title = markers && markers.length > 0 ? `UPF markers: ${markers.join(", ")}` : "Ultra-processed (NOVA 4)";
  return (
    <span
      title={title}
      className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 uppercase tracking-wide ${className ?? ""}`}
    >
      UPF
    </span>
  );
}

/** Small NOVA class label for the ingredients table / form — all four
 *  classes get a colour so "classified, not UPF" is visibly different
 *  from "not yet classified". */
export function NovaPill({ novaClass, markers }: { novaClass?: number | null; markers?: string[] | null }) {
  if (novaClass == null) return <span className="text-xs text-muted-foreground/40">—</span>;
  if (novaClass === 4) return <UpfChip novaClass={4} markers={markers} />;
  const styles: Record<number, string> = {
    1: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    2: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    3: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  };
  const labels: Record<number, string> = { 1: "NOVA 1", 2: "NOVA 2", 3: "NOVA 3" };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${styles[novaClass] ?? ""}`}>
      {labels[novaClass] ?? `NOVA ${novaClass}`}
    </span>
  );
}

export function formatUpfPercent(percent: number): string {
  if (percent === 0) return "0%";
  if (percent < 1) return "<1%";
  if (percent < 10) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}

/** UPF-by-weight pill for a recipe or sub-recipe.
 *  Green when UPF-free, amber under 10 %, red at 10 %+.
 *  `unclassifiedCount` > 0 adds a "?" — the number can't be trusted until
 *  every ingredient is classified. */
export function UpfPercentPill({
  percent,
  unclassifiedCount = 0,
  upfNames,
  className,
}: {
  percent: number | null | undefined;
  unclassifiedCount?: number;
  /** Names of the UPF ingredients driving the number — shown on hover. */
  upfNames?: string[];
  className?: string;
}) {
  if (percent == null) {
    return <span className={`text-xs text-muted-foreground/40 ${className ?? ""}`}>—</span>;
  }
  const pending = unclassifiedCount > 0;
  const colour = percent <= 0
    ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
    : percent < 10
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
      : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
  const titleParts: string[] = [];
  if (percent > 0 && upfNames && upfNames.length > 0) titleParts.push(`UPF: ${upfNames.join(", ")}`);
  if (pending) titleParts.push(`${unclassifiedCount} ingredient${unclassifiedCount === 1 ? "" : "s"} not yet classified`);
  return (
    <span
      title={titleParts.join(" · ") || undefined}
      className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums ${colour} ${className ?? ""}`}
    >
      {percent <= 0 ? "UPF-free" : `${formatUpfPercent(percent)} UPF`}
      {pending && <span className="font-normal opacity-70">?</span>}
    </span>
  );
}
