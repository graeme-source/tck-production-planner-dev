/**
 * An order's estimated total as a green pill (Graeme, 2026-11-18). Ten times
 * the butter went out once; the price gave it away straight away when set
 * beside the supplier's own total, so the total is made hard to miss — on
 * each To Order card and in the "Mark as Placed" confirm.
 * Brand green (Fresh Basil #7cb342) with white text.
 */
import { cn } from "@/lib/utils";
import { orderTotalSummary } from "@/lib/order-total-summary";

export function formatOrderTotal(n: number): string {
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP" });
}

export function OrderTotalPill({ total, size = "md", className }: {
  total: number;
  size?: "md" | "lg";
  className?: string;
}) {
  if (!(total > 0)) return null;
  return (
    <span
      title="Estimated order total at this supplier's prices"
      className={cn(
        "inline-flex items-center rounded-full bg-[#7cb342] text-white font-bold tabular-nums whitespace-nowrap",
        size === "lg" ? "px-4 py-1.5 text-xl" : "px-2.5 py-0.5 text-sm",
        className,
      )}
    >
      {formatOrderTotal(total)}
    </span>
  );
}

/** The big total bar under an order's lines. */
export function OrderTotalBar({ lines }: { lines: ReadonlyArray<{ editedPacks: number; costPerPack: number; isMisc?: boolean }> }) {
  const s = orderTotalSummary(lines);
  if (s.lines === 0) return null;
  return (
    <div className="px-4 py-3 border-t-2 border-[#7cb342]/40 bg-[#7cb342]/10 flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
      {s.unpriced > 0 && (
        <span className="text-sm text-amber-700 dark:text-amber-400 font-medium mr-auto">
          {s.unpriced} {s.unpriced === 1 ? "item has" : "items have"} no price saved, so {s.unpriced === 1 ? "isn't" : "aren't"} in the total
        </span>
      )}
      <span className="text-base font-semibold">Order total</span>
      <span className="text-3xl font-extrabold tabular-nums text-[#4f7a22] dark:text-[#9ccc65]">
        {s.total > 0 ? formatOrderTotal(s.total) : "—"}
      </span>
    </div>
  );
}
