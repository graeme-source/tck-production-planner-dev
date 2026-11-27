/**
 * APC check — one button, one page (Graeme, 27 Nov 2026): the Friday
 * dispatch check and the APC consignment check used to be two buttons on
 * Order Packing Live. Both are "check with APC" tools you run now and then
 * (unlike Booking issues today, which is the live to-do during the pack), so
 * they're two tabs here, with nothing taken away from either:
 *
 *   - Saturday deliveries — the Friday dispatch check (any day before a
 *     Friday: which of that Friday's orders APC won't deliver on Saturday).
 *   - Consignments — orders that went out on an old or cancelled booking, and
 *     old bookings that may still be live at APC (runs itself at 17:30).
 *     Courier managers only, as before (the API enforces it too).
 *
 * ?tab=saturday | consignments. Without one: Wednesday to Friday open on
 * Saturday deliveries, other days on Consignments (if allowed). The old
 * /fulfilment/friday-check link lands on the Saturday tab. Objective C.
 */
import { useState } from "react";
import { useSearch } from "wouter";
import { CalendarX, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { useFeatureAccess } from "@/hooks/use-feature-access";
import { useConsignmentCheck } from "@/components/apc-consignment-check/api";
import FridayDispatchCheck from "./friday-dispatch-check";
import ApcConsignmentCheckPage from "./apc-consignment-check";

type Tab = "saturday" | "consignments";

function defaultTab(canConsignments: boolean): Tab {
  if (!canConsignments) return "saturday";
  const day = new Date().toLocaleDateString("en-GB", { weekday: "long", timeZone: "Europe/London" });
  return ["Wednesday", "Thursday", "Friday"].includes(day) ? "saturday" : "consignments";
}

function ConsignmentCount() {
  const { data } = useConsignmentCheck(45);
  const n = data ? data.mismatches.length + data.oldBookings.length : 0;
  return n > 0 ? <span className="text-sm px-2 py-0.5 rounded-full tabular-nums bg-red-600 text-white">{n}</span> : null;
}

export default function ApcChecks() {
  const { can } = useFeatureAccess();
  const canConsignments = can("ability.book_apc_labels");
  const asked = new URLSearchParams(useSearch()).get("tab");
  const [tab, setTab] = useState<Tab>(
    asked === "saturday" ? "saturday" : asked === "consignments" && canConsignments ? "consignments" : defaultTab(canConsignments),
  );
  const tabs: Array<{ key: Tab; label: string; icon: React.ReactNode; show: boolean }> = [
    { key: "saturday", label: "Saturday deliveries", icon: <CalendarX className="w-5 h-5" />, show: true },
    { key: "consignments", label: "Consignments", icon: <ShieldCheck className="w-5 h-5" />, show: canConsignments },
  ];
  return (
    <div className="p-4 md:p-6 space-y-5 w-full">
      <PageHeader title="APC check" description="Saturday deliveries APC won't make this Friday, and bookings that went wrong or are still live at APC." />
      <div role="tablist" className="flex flex-wrap gap-2">
        {tabs.filter(t => t.show).map(t => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={cn("h-12 px-5 rounded-xl border-2 text-base font-bold inline-flex items-center gap-2 transition-colors",
              tab === t.key ? "bg-primary/5 border-primary text-primary" : "bg-card border-border hover:border-primary/50")}>
            {t.icon} {t.label}
            {t.key === "consignments" && <ConsignmentCount />}
          </button>
        ))}
      </div>
      {tab === "saturday" ? <FridayDispatchCheck embedded /> : <ApcConsignmentCheckPage embedded />}
    </div>
  );
}
