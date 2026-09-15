/**
 * One-tap "print ingredient label" (Stage 2 of prep labels, 2026-09-08).
 *
 * The entire point is beating a pen: ONE tap, no dialog. The server resolves
 * everything from the ingredient's label rules (own opened-life days →
 * category default → conservative fallback) and the toast reads the printed
 * use-by back, so a wrong rule is spotted at the bench, not in an audit.
 * If the bridge is offline the toast says so instead of pretending.
 */
import { useMutation } from "@tanstack/react-query";
import { Printer, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function fmtNice(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function PrintIngredientLabelButton({ ingredientId, itemName, className, compact = false }: {
  ingredientId: number;
  /** Only for the toast — the server prints the DB name. */
  itemName: string;
  className?: string;
  /** Icon-only, for tight rows. */
  compact?: boolean;
}) {
  const print = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/print-jobs`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "ingredient", fields: { ingredientId } }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to queue the label");
      return body as { payload?: { useBy?: string }; bridgeOnline?: boolean };
    },
    onSuccess: (r) => {
      const useBy = r.payload?.useBy ? ` — use by ${fmtNice(r.payload.useBy)}` : "";
      toast(r.bridgeOnline === false
        ? {
            title: `Label queued${useBy}`,
            description: "The printer bridge is offline — it will print when the bridge reconnects.",
            variant: "destructive",
          }
        : { title: `Label printing${useBy}`, description: itemName });
    },
    onError: err => toast({
      title: "Couldn't print the label",
      description: err instanceof Error ? err.message : undefined,
      variant: "destructive",
    }),
  });

  return (
    <button
      onClick={e => { e.stopPropagation(); print.mutate(); }}
      disabled={print.isPending}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border border-border text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors disabled:opacity-50",
        compact ? "p-2" : "px-3 py-1.5 text-sm font-medium",
        className,
      )}
      title={`Print ingredient label for ${itemName}`}
    >
      {print.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
      {!compact && "Label"}
    </button>
  );
}
