/**
 * An order's estimated total as a green pill (Graeme, 2026-11-18). Ten times
 * the butter went out once; the price gave it away straight away when set
 * beside the supplier's own total, so the total is made hard to miss — on
 * each To Order card and in the "Mark as Placed" confirm.
 * Brand green (Fresh Basil #7cb342) with white text.
 */
import { cn } from "@/lib/utils";

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
