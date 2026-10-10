/**
 * "Pack label" on the recipe page — the label is named, so it links
 * (house rule), with its live status so a recipe edit that needs a label
 * update is visible right where the edit happened.
 */
import { Link } from "wouter";
import { ChevronRight, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_TONE, useRecipeLabel } from "./api";

export function RecipeLabelLink({ recipeId, active }: { recipeId: number; active: boolean }) {
  const q = useRecipeLabel(active ? recipeId : null);
  return (
    <Link
      href={`/labels/${recipeId}`}
      className="mt-4 flex items-center gap-3 rounded-xl border-2 border-border bg-card px-4 py-3 hover:border-primary/60"
    >
      <Tag className="w-5 h-5 text-[#7cb342] shrink-0" />
      <span className="font-semibold flex-1">Pack label</span>
      {q.data && (
        <span className={cn("px-2.5 py-0.5 rounded-full border text-xs font-bold", STATUS_TONE[q.data.status])}>
          {q.data.status === "update-needed" ? "Label update needed" : q.data.statusLabel}
        </span>
      )}
      <ChevronRight className="w-5 h-5 text-muted-foreground" />
    </Link>
  );
}
