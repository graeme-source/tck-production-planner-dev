/**
 * Wrap-to-Shopify status on the wrapping screen (Graeme, 16 Oct 2026) for
 * recipes flagged shopify_push_on_wrap: every freezer add sends +N packs to
 * the recipe's Shopify variant, every take-back −N. The server keeps a
 * ledger (api-server lib/shopify-wrap-push.ts) and works out each item's
 * state; this only shows it, with Retry for a failed send.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, Loader2, RotateCcw, CloudOff } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import { shopifyWrapStatusText, type ShopifyWrapState } from "@/lib/shopify-wrap-status-text";
export { shopifyWrapStatusText, type ShopifyWrapState };

interface PushesResponse {
  byItem: Record<number, ShopifyWrapState>;
}

export function useShopifyWrapPushes(planId: number, enabled: boolean) {
  return useQuery<PushesResponse>({
    queryKey: ["shopify-wrap-pushes", planId],
    enabled,
    queryFn: async () => {
      const res = await fetch(`/api/production-plans/${planId}/shopify-wrap-pushes`, { credentials: "include" });
      if (!res.ok) throw new Error("Couldn't load the Shopify updates");
      return res.json();
    },
    refetchInterval: 60_000,
  });
}

/** One id per tap — the ledger's key, so a repeated request is one event. */
export function newWrapEventId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function ShopifyWrapStatus({ state, onRetried }: { state: ShopifyWrapState | undefined; onRetried: () => void }) {
  const retry = useMutation({
    mutationFn: async (ids: number[]) => {
      for (const id of ids) {
        const res = await fetch(`/api/shopify-wrap-pushes/${id}/retry`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" }, body: "{}",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error ?? `Retry failed (${res.status})`);
        }
      }
    },
    retry: false,
    onSettled: () => onRetried(),
    onError: (err) => toast({ title: "Shopify retry failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });
  const { tone, text } = shopifyWrapStatusText(state);
  const Icon = tone === "ok" ? CheckCircle2 : tone === "busy" ? Loader2 : tone === "off" ? CloudOff : AlertTriangle;
  return (
    <div className={cn(
      "rounded-xl border px-3 py-2.5 flex items-center gap-2 text-sm",
      tone === "ok" && "border-emerald-300 bg-emerald-50/70 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200",
      tone === "busy" && "border-border bg-secondary/40 text-foreground",
      tone === "bad" && "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200",
      (tone === "off" || tone === "none") && "border-border bg-secondary/30 text-muted-foreground",
    )}>
      <Icon className={cn("w-4 h-4 flex-shrink-0", tone === "busy" && "animate-spin")} />
      <span className="flex-1 min-w-0 font-medium">{text}</span>
      {state?.state === "failed" && (
        <button
          type="button"
          onClick={() => retry.mutate(state.failedIds)}
          disabled={retry.isPending}
          className="h-11 px-4 rounded-lg bg-red-600 text-white text-sm font-bold flex items-center gap-1.5 hover:bg-red-700 disabled:opacity-50 flex-shrink-0"
        >
          {retry.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} Retry
        </button>
      )}
    </div>
  );
}
