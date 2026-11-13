// Desserts report — Order Packing Live's step 3 (after tagging and booking
// the APC labels) and, read-only, the opening checklist. Grouped server-side
// (lib/desserts-report) so every surface agrees.
//
// 13 Nov 2026 (Graeme): one line per item — "Cinnamon Buns 3 · Print 3 labels
// · Print some", "5-packs 4 · Print 4 labels · Print some" — with the flavour
// breakdown behind "Flavours". The buttons ask only for the labels still
// needed (orders − already printed for the dispatch day), and grey out with
// "All labels printed today" once done, so a later despatch prints just the
// new orders' labels.

import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { FivePackLabelsButton, useFivePackLabels } from "@/components/five-pack-labels";
import { DespatchLabelsButton, useDespatchLabels } from "@/components/despatch-labels";

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
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/** Are dessert labels still needed for this dispatch day? Only labels that
 *  CAN print count (a dessert whose label isn't published can't hold up
 *  packing). `loading` = not known yet. */
export function useDessertLabelsStatus(tag: string, enabled = true): { loading: boolean; left: number } {
  const despatch = useDespatchLabels(tag);
  const fivePack = useFivePackLabels(tag);
  if (!enabled) return { loading: false, left: 0 };
  const loading = (despatch.isLoading && !despatch.isError) || (fivePack.isLoading && !fivePack.isError);
  const despatchLeft = (despatch.data?.lines ?? [])
    .filter(l => l.ready && l.recipeId != null)
    // One recipe can come from several lines (2-pack, 8-pack) — count it once.
    .reduce((m, l) => m.set(l.recipeId as number, l.left ?? l.count), new Map<number, number>());
  const left = [...despatchLeft.values()].reduce((t, n) => t + n, 0) + (fivePack.data?.left ?? 0);
  return { loading, left };
}

function Row({ name, value, children }: { name: string; value: number; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
      <span className="font-semibold text-base text-pink-900 dark:text-pink-100 min-w-[9rem]">{name}</span>
      <span className="font-display font-extrabold tabular-nums text-2xl text-pink-800 dark:text-pink-200 min-w-[2.5rem]">{value}</span>
      {children}
    </div>
  );
}

/** printable=false: the counts only, and where to print them (the opening
 *  checklist — printing happens on Order Packing Live after the APC labels
 *  are booked, so the order can't be skipped). */
export function DessertsReportCard({ tag, className, printable = true, title }: { tag: string; className?: string; printable?: boolean; title?: string }) {
  const { data: desserts } = useDessertsReport(tag);
  const fivePack = desserts?.fivePackProducts ?? [];
  if (!desserts || (desserts.products.length === 0 && fivePack.length === 0)) return null;

  return (
    <div className={`bg-pink-50 dark:bg-pink-950/30 border border-pink-200 dark:border-pink-900 rounded-xl overflow-hidden divide-y divide-pink-200/70 dark:divide-pink-900/60 ${className ?? ""}`}>
      {title && <p className="px-4 pt-2.5 pb-1 text-sm font-bold uppercase tracking-wide text-pink-800 dark:text-pink-300">{title}</p>}
      {desserts.products.map(p => (
        <Row key={p.title} name={p.title} value={p.quantity}>
          {printable && <DespatchLabelsButton tag={tag} title={p.title} />}
        </Row>
      ))}
      {fivePack.length > 0 && (
        <Row name="5-packs" value={desserts.fivePackTotal ?? 0}>
          {printable && <FivePackLabelsButton tag={tag} />}
        </Row>
      )}
      {!printable && (
        <p className="px-4 py-2.5 text-sm text-pink-900/80 dark:text-pink-200/80">
          Print these on <Link href={`/fulfilment?tag=${encodeURIComponent(tag)}`} className="font-semibold underline underline-offset-2">Order Packing Live</Link> once the APC labels are booked.
        </p>
      )}
    </div>
  );
}
