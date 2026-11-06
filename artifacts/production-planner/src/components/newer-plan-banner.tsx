/**
 * Orders page: tells you when a newer production plan exists than the one
 * selected, so its items aren't missed (lib/newer-plan.ts). "Stay" holds for
 * this pair of plans until the browser tab closes, as the plan choice does.
 */
import { useState } from "react";
import { format, parseISO } from "date-fns";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";

const day = (iso: string) => format(parseISO(iso), "EEEE d MMM");

export function NewerPlanBanner({ selected, newer, onSwitch }: {
  selected: { id: number; planDate: string };
  newer: { id: number; planDate: string };
  onSwitch: (id: number) => void;
}) {
  const key = `orders_stayOnPlan_${selected.id}_${newer.id}`;
  const [stayed, setStayed] = useState(() => sessionStorage.getItem(key) === "1");
  if (stayed) return null;
  return (
    <div className="rounded-2xl border-2 border-amber-500 bg-card p-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3 flex-1 min-w-[16rem]">
        <CalendarClock className="w-5 h-5 text-amber-600 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-base font-semibold">There's a newer plan: {day(newer.planDate)}</p>
          <p className="text-sm text-muted-foreground">These orders are for {day(selected.planDate)}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => { sessionStorage.setItem(key, "1"); setStayed(true); }}>
          Stay on {format(parseISO(selected.planDate), "EEE d MMM")}
        </Button>
        <Button onClick={() => onSwitch(newer.id)}>
          Switch to {format(parseISO(newer.planDate), "EEE d MMM")}
        </Button>
      </div>
    </div>
  );
}
