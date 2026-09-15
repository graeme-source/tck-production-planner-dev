/**
 * Order numbers link to their Shopify admin page — everywhere (Graeme,
 * 2026-09-15). Extracted from the fulfilment page's OrderNumber: whoever is
 * assessing an order ends up in Shopify, and hunting for it by hand is the
 * slow part. Opens in a new tab so the current screen stays put.
 *
 * The admin base URL comes from /api/fulfilment/config-status — fetched
 * once and cached (same query key the fulfilment page uses, so no extra
 * request there). Callers may still pass `adminBase` to skip the hook's
 * fetch. Falls back to plain text while the base loads or when the caller
 * can't read config, so the number itself is never missing.
 */
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function useShopifyAdminBase(): string | undefined {
  const { data } = useQuery<{ shopifyAdminOrderBase?: string }>({
    queryKey: ["fulfilment-config-status"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/fulfilment/config-status`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load config");
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  return data?.shopifyAdminOrderBase;
}

export function ShopifyOrderNumber({ orderId, name, adminBase, className }: {
  orderId: number | string;
  name: string;
  adminBase?: string;
  className?: string;
}) {
  const hookBase = useShopifyAdminBase();
  const base = adminBase ?? hookBase;
  // No base yet, or a synthetic row with no real order id — plain text.
  if (!base || !orderId) return <span className={className}>{name}</span>;
  return (
    <a
      href={`${base}${orderId}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      // Underlined ALWAYS, not just on hover: iPads have no hover state, so
      // a hover-only affordance is invisible to the people using it.
      className={cn(className, "underline decoration-dotted underline-offset-2 decoration-current/40 hover:decoration-current")}
      title={`Open ${name} in Shopify`}
    >
      {name}
    </a>
  );
}
