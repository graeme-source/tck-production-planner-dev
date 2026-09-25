import { Link } from "wouter";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Amber "this time is a guess" flag for the day schedule and the meat
 * "start cooking by" cards (Graeme, 2026-09-25). The label itself is the link
 * to where the missing value is set — anything the UI names, it links.
 */

/** Where a recipe's build time is set: the Recipes page opens its edit form. */
export function recipeTimingHref(recipeId: number): string {
  return `/recipes?edit=${recipeId}`;
}

/** Where a raw meat's cook/process minutes are set: its ingredient edit form. */
export function ingredientTimingHref(ingredientId: number): string {
  return `/inventory?tab=ingredients&edit=${ingredientId}`;
}

/** Plain-English label for a meat's missing lead-time input. */
export function meatMissingLabel(missing: "cook" | "process" | "both" | null | undefined): string | null {
  switch (missing) {
    case "both": return "No cook time set";
    case "cook": return "No cook time set — start time is too late";
    case "process": return "No process time set — start time may be too late";
    default: return null;
  }
}

export function TimingFlag({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      className={cn(
        "inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full",
        "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
        "underline-offset-2 hover:underline whitespace-nowrap",
        className,
      )}
    >
      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
      {children}
    </Link>
  );
}
