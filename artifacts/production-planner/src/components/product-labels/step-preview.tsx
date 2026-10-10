/**
 * What step 2 will print, worked out with the SAME functions the label uses
 * (halving + fill-ins + line handling from @workspace/product-labels), shown
 * next to the cooking times so the halves are visible while typing.
 */
import { cookingPlaceholderValues, fillTemplate, stepLines, type CookingValues } from "@workspace/product-labels";
import { cn } from "@/lib/utils";

export function StepPreview({ wording, cooking, className }: { wording: string; cooking: CookingValues; className?: string }) {
  const filled = fillTemplate(wording, cookingPlaceholderValues(cooking));
  const lines = stepLines(filled.text);
  return (
    <div className={cn("rounded-xl border-2 border-primary/40 bg-primary/5 p-3 space-y-1", className)}>
      <p className="text-xs font-bold uppercase tracking-wide text-primary">Step 2 will print</p>
      {lines.length === 0 ? (
        <p className="text-sm text-destructive font-semibold">Nothing — fill in the oven or air-fryer times.</p>
      ) : lines.map((runs, i) => (
        <p key={i} className="text-base leading-snug">
          {runs.map((r, j) => <span key={j} className={r.bold ? "font-bold" : undefined}>{r.text.replace(/ /g, " ")}</span>)}
        </p>
      ))}
      {filled.unknown.length > 0 && (
        <p className="text-sm text-destructive">Unknown fill-in: {filled.unknown.map(u => `{${u}}`).join(", ")}</p>
      )}
      <p className="text-xs text-muted-foreground">Each time is split in two around TURN OVER; the halves always add up to the full time.</p>
    </div>
  );
}
