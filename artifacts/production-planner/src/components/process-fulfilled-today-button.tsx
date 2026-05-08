import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";

interface ProcessResult {
  processedCount: number;
  alreadyTaggedCount: number;
  decrementedPacks: number;
  perRecipe: Array<{ recipeId: number; packs: number }>;
  unmappedVariants: string[];
  skippedNonCore: number;
  errors: Array<{ orderId: number; orderName: string; stage: "decrement" | "tag"; message: string }>;
}

async function processFulfilledToday(): Promise<ProcessResult> {
  const res = await fetch(`${BASE}api/fulfilment/process-fulfilled-today`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

interface Props {
  /** Extra Tailwind classes — lets callers match the button to adjacent controls. */
  className?: string;
  /** Size preset. "md" matches the "Create Plan" button in the Production Plans header;
   *  "sm" matches the "Add Stock" / "Unlock" buttons on Stock Control. */
  size?: "sm" | "md";
}

/**
 * Triggers POST /api/fulfilment/process-fulfilled-today. Shows a toast with
 * the result, then invalidates stock-control queries so the UI reflects the
 * new fridge quantities. Used from the Production Plans page header AND the
 * Stock Control production-fridge panel — same behaviour in both places.
 */
export function ProcessFulfilledTodayButton({ className, size = "md" }: Props) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: processFulfilledToday,
    onSuccess: (result) => {
      // Prime message
      if (result.processedCount > 0) {
        const recipeBit = result.perRecipe.length > 0
          ? ` across ${result.perRecipe.length} recipe${result.perRecipe.length === 1 ? "" : "s"}`
          : "";
        toast({
          title: `Processed ${result.processedCount} order${result.processedCount === 1 ? "" : "s"}`,
          description: `Decremented ${result.decrementedPacks} pack${result.decrementedPacks === 1 ? "" : "s"}${recipeBit}.`,
        });
      } else {
        toast({
          title: "Nothing to process",
          description: "No newly-fulfilled orders since midnight.",
        });
      }

      // Amber warning for unmapped variants — surfaced as a second toast so
      // the primary result stays readable.
      if (result.unmappedVariants.length > 0) {
        toast({
          title: `${result.unmappedVariants.length} unmapped variant${result.unmappedVariants.length === 1 ? "" : "s"}`,
          description: `Recipe mapping missing for: ${result.unmappedVariants.slice(0, 5).join(", ")}${result.unmappedVariants.length > 5 ? "…" : ""}. Add mappings in the Recipes page.`,
        });
      }

      // Per-order errors — red.
      if (result.errors.length > 0) {
        const firstFew = result.errors.slice(0, 3)
          .map(e => `${e.orderName} (${e.stage}): ${e.message}`)
          .join("; ");
        toast({
          variant: "destructive",
          title: `${result.errors.length} order${result.errors.length === 1 ? "" : "s"} failed`,
          description: firstFew + (result.errors.length > 3 ? "…" : ""),
        });
      }

      // Make the fridge quantities refetch so the user sees the change
      // immediately on Stock Control (and the Production Plans page if it
      // surfaces fridge info).
      queryClient.invalidateQueries({ queryKey: ["stock-control"] });
      queryClient.invalidateQueries({ queryKey: ["stock-control-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["fridge-batches"] });
      queryClient.invalidateQueries({ queryKey: ["production-plan-calculate"] });
      queryClient.invalidateQueries({ queryKey: ["factory-numbers"] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast({
        variant: "destructive",
        title: "Couldn't process fulfilled orders",
        description: msg,
      });
    },
  });

  const sizeClasses = size === "sm"
    ? "text-xs px-3 py-2 rounded-lg gap-1.5"
    : "text-sm px-5 py-2.5 rounded-xl gap-2 font-medium";
  const iconSize = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";

  return (
    <button
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      className={cn(
        "flex items-center border transition-colors disabled:opacity-60",
        "border-border text-muted-foreground hover:text-foreground hover:bg-secondary",
        sizeClasses,
        className,
      )}
      title="Fetch today's fulfilled Shopify orders and decrement production-fridge stock. Safe to click repeatedly — already-processed orders are skipped via a Shopify tag."
    >
      {mutation.isPending
        ? <Loader2 className={cn(iconSize, "animate-spin")} />
        : <PackageCheck className={iconSize} />
      }
      {mutation.isPending ? "Processing…" : "Process Fulfilled Today"}
    </button>
  );
}
