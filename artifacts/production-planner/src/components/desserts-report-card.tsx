// Desserts report card — shared by Order Packing Live (top, beside the
// ice-pack banner) and anywhere else the report is needed. Grouped
// server-side (lib/desserts-report) so every surface agrees.
//
// UI rule (Graeme, 2026-08-28): the 5-pack-labels row and each other
// dessert (cinnamon buns) are EQUAL headline rows — same banner styling —
// because the packer starts the day with two numbers, not one. Cinnamon
// buns sit on top; the 5-pack banner keeps its per-recipe breakdown
// underneath, as before.

import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface DessertsReport {
  products: Array<{ title: string; quantity: number }>;
  fivePackProducts?: Array<{ title: string; quantity: number }>;
  fivePackTotal?: number;
  totalQuantity: number;
}

export function useDessertsReport(tag: string) {
  return useQuery<DessertsReport>({
    queryKey: ["desserts-report", tag],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/fulfilment/desserts-report?tag=${encodeURIComponent(tag)}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
  });
}

function BannerRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-semibold text-base text-pink-900 dark:text-pink-100">{label}</span>
      <span className="font-bold tabular-nums text-xl text-pink-800 dark:text-pink-200">{value}</span>
    </div>
  );
}

export function DessertsReportCard({ tag, className }: { tag: string; className?: string }) {
  const { data: desserts } = useDessertsReport(tag);
  const fivePack = desserts?.fivePackProducts ?? [];
  if (!desserts || (desserts.products.length === 0 && fivePack.length === 0)) return null;

  return (
    <div className={`bg-card border border-border rounded-xl overflow-hidden ${className ?? ""}`}>
      <div className="px-4 py-3 border-b border-border/50 bg-pink-50/50 dark:bg-pink-900/10">
        <div className="flex items-center gap-2">
          <span className="text-lg">🍰</span>
          <h3 className="font-semibold text-base">Desserts Report</h3>
          <span className="text-sm text-muted-foreground ml-auto">{desserts.totalQuantity} units total</span>
        </div>
      </div>
      {/* Every headline number gets the same banner treatment — cinnamon
          buns first, then the grouped 5-pack label count. */}
      {desserts.products.map(p => (
        <div key={p.title} className="px-4 py-3 bg-pink-100/60 dark:bg-pink-900/20 border-b border-border/50">
          <BannerRow label={p.title} value={p.quantity} />
        </div>
      ))}
      {fivePack.length > 0 && (
        <div className="px-4 py-3 bg-pink-100/60 dark:bg-pink-900/20 border-b border-border/50">
          <BannerRow label="5-Pack labels to print" value={desserts.fivePackTotal ?? 0} />
          <div className="mt-1.5 space-y-1">
            {fivePack.map(p => (
              <div key={p.title} className="flex items-center justify-between text-sm text-pink-900/80 dark:text-pink-200/80">
                <span className="truncate">{p.title}</span>
                <span className="font-semibold tabular-nums shrink-0 ml-2">{p.quantity}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
