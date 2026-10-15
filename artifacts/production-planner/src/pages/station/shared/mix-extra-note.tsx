import { formatPrepWeight } from "@workspace/units";
import { cn } from "@/lib/utils";

/**
 * "includes +75 g mix extra" — shown under a prep total that carries a
 * recipe's Mix +g (the extra the mixing station adds once per production
 * day; api-server lib/mix-extra.ts), so the team knows why the number is
 * higher than the batches alone. Renders nothing when there's no extra.
 */
export function MixExtraNote({ qty, unit, className }: { qty?: number | null; unit: string | null | undefined; className?: string }) {
  if (!qty || !(qty > 0)) return null;
  return (
    <span
      className={cn("block text-xs font-medium text-amber-700 dark:text-amber-400", className)}
      title="Mix +g on the recipe: extra the mixing station adds once per production day, so it's prepped too"
    >
      includes +{formatPrepWeight(qty, unit)} mix extra
    </span>
  );
}
