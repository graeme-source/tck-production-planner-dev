import { cn } from "@/lib/utils";
import { addDays, calendarWeeks, daysBetween } from "@/lib/order-date-calendar";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function monthShort(s: string): string {
  return new Date(`${s}T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export interface MakeCandidate {
  date: string;
  ok: boolean;
  /** Why this day can't carry the order, e.g. "no plan". */
  reason?: string;
}

/**
 * Mini Mon–Sun calendar for one order in the 8-pack & wholesale dialog:
 * Today, Make, Send (despatch = delivery − 1) and Deliver marked on real
 * weeks, so the spacing is obvious across a month end. Other days the bags
 * could be made on are outlined and tappable to move Make there.
 */
export function OrderDateCalendar({
  today,
  delivery,
  production,
  candidates = [],
  onPickProduction,
}: {
  today: string;
  delivery: string;
  /** Omitted for tag-only wholesale orders, which have no Make day. */
  production?: string;
  candidates?: MakeCandidate[];
  onPickProduction?: (date: string) => void;
}) {
  const despatch = addDays(delivery, -1);
  const start = production && production < today ? production : today;
  const weeks = calendarWeeks(start, delivery);
  const candidateByDate = new Map(candidates.map(c => [c.date, c]));

  return (
    <div className="mt-3 rounded-xl border border-border bg-muted/30 p-3 max-w-md">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mb-2">
        {production && (
          <>
            <span><span className="font-semibold tabular-nums">{plural(daysBetween(production, delivery), "day")}</span> make → deliver</span>
            <span className="text-muted-foreground"><span className="font-semibold tabular-nums">{plural(daysBetween(production, despatch), "day")}</span> make → send</span>
          </>
        )}
        <span className="text-muted-foreground"><span className="font-semibold tabular-nums">{plural(daysBetween(today, delivery), "day")}</span> until delivery</span>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map(w => (
          <div key={w} className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{w}</div>
        ))}
        {weeks.flat().map((d, i) => {
          const inRange = d >= start && d <= delivery;
          const isToday = d === today;
          const isMake = d === production;
          const isSend = d === despatch;
          const isDeliver = d === delivery;
          const candidate = candidateByDate.get(d);
          const pickable = !!candidate && !isMake && !!onPickProduction;
          const label = isDeliver ? "Deliver"
            : isMake && isSend ? "Make+Send"
              : isMake ? "Make"
                : isSend ? "Send"
                  : isToday ? "Today" : null;
          // Show the month on the first cell and on every 1st, so a month
          // boundary can't be missed.
          const showMonth = i === 0 || d.endsWith("-01");
          const Cell = pickable ? "button" : "div";
          return (
            <Cell
              key={d}
              {...(pickable ? { type: "button" as const, onClick: () => onPickProduction!(d) } : {})}
              title={candidate && !isMake
                ? `Make on this day instead${candidate.ok ? "" : ` — ${candidate.reason ?? "not ready"}`}`
                : undefined}
              className={cn(
                "relative h-14 rounded-lg flex flex-col items-center justify-center leading-tight border",
                !inRange && "opacity-35 border-transparent",
                inRange && "border-transparent bg-background",
                isMake && "bg-indigo-600 text-white border-indigo-600",
                isSend && !isMake && "bg-amber-500 text-white border-amber-500",
                isDeliver && "bg-emerald-600 text-white border-emerald-600",
                isToday && "ring-2 ring-foreground ring-offset-1 ring-offset-background",
                pickable && "border-dashed border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 cursor-pointer",
                pickable && !candidate!.ok && "border-amber-400",
                d.endsWith("-01") && "border-l-2 border-l-foreground/40",
              )}
            >
              {showMonth && <span className="text-[10px] font-semibold uppercase opacity-80">{monthShort(d)}</span>}
              <span className="text-base font-semibold tabular-nums">{Number(d.slice(8))}</span>
              {label && <span className="text-[10px] font-semibold">{label}</span>}
            </Cell>
          );
        })}
      </div>

      {candidates.length > 1 && onPickProduction && (
        <p className="text-xs text-muted-foreground mt-2">Dashed days could also carry the bags — tap one to make on that day.</p>
      )}
    </div>
  );
}
