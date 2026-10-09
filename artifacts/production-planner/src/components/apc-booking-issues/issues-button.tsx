/**
 * "Booking issues today (N open)" — the way back into today's saved issues
 * report from the packing screen. Only there when today has any; red while
 * something is still open, green when everything is done. Opening it reads
 * the stored report — it never books anything with APC.
 */
import { ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBookingIssuesCount } from "./api";

export function BookingIssuesButton({ onOpen }: { onOpen: () => void }) {
  const { data } = useBookingIssuesCount();
  if (!data || data.total === 0) return null;
  const open = data.open;
  return (
    <button
      onClick={onOpen}
      className={cn(
        "px-5 py-3 rounded-xl text-base font-bold transition-colors flex items-center gap-2 border-2",
        open > 0
          ? "bg-red-600 border-red-600 text-white hover:bg-red-700"
          : "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-400 text-emerald-900 dark:text-emerald-100 hover:bg-emerald-100",
      )}
      title="Today's APC booking problems — saved, so this reopens the report without booking again"
    >
      <ClipboardList className="w-5 h-5" />
      Booking issues today ({open > 0 ? `${open} open` : "all done"})
    </button>
  );
}
