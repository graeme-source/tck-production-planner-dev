/**
 * What APC's postcode table says an address can take, at a glance (Graeme,
 * 2026-10-02): next-day weekday and Saturday on two separate lines in big
 * text with a tick or a cross, then the depot. Underneath, in amber, the
 * advice when APC refused something the table says the depot normally
 * does (a temporary depot restriction — reschedule, check with a manager).
 * Blue, as before, so it still reads as "the postcode check".
 */
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PostcodeServiceFacts {
  matchedOn: string;
  depot: string;
  nextDay: boolean;
  weekdayCutoff: string | null;
  transitDays: number | null;
  saturdayDelivery: boolean;
  saturdayCutoff: string | null;
}

function Line({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-base font-semibold">
      {ok
        ? <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        : <XCircle className="w-5 h-5 shrink-0 text-red-600 dark:text-red-400" />}
      <span>{children}</span>
    </p>
  );
}

export function PostcodeServiceCard({ service, advice, className }: {
  service: PostcodeServiceFacts;
  advice?: string | null;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-blue-950 dark:text-blue-100 space-y-1">
        <Line ok={service.nextDay}>
          {service.nextDay
            ? <>Next-day weekdays{service.weekdayCutoff ? <> — by {service.weekdayCutoff}</> : null}</>
            : service.transitDays
              ? <>No next-day service — {service.transitDays} days in transit</>
              : <>No next-day weekday service</>}
        </Line>
        <Line ok={service.saturdayDelivery}>
          {service.saturdayDelivery
            ? <>Saturday{service.saturdayCutoff ? <> — by {service.saturdayCutoff}</> : null}</>
            : <>No Saturday delivery</>}
        </Line>
        <p className="text-xs text-blue-800/80 dark:text-blue-300/80">
          {service.matchedOn} · Depot {service.depot} · from APC's postcode table
        </p>
      </div>
      {advice && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-950 dark:text-amber-100 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
          <span>{advice}</span>
        </div>
      )}
    </div>
  );
}
