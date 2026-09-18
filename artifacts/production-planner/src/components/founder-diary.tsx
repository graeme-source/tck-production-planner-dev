/**
 * The founder's diary for one day — straight from Apple Calendar (CalDAV,
 * read-only). Big rows, one line of information each: when, what, and the
 * join link if there is one.
 *
 * This is half of what the Schedule page is for. Everything else it used to
 * carry now lives behind the "Planning tools" disclosure.
 */
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Video, ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  founderFocusApi,
  minToTime,
  readCachedFocus,
  writeCachedFocus,
  type CalEvent,
  type DayEvents,
} from "@/lib/founder-focus-api";

/** Minutes from midnight, now. */
function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function FounderDiary({ dateStr, isToday, onOpenPlanningTools }: {
  dateStr: string;
  isToday: boolean;
  /** Offered when the calendar isn't connected — the setup card lives there. */
  onOpenPlanningTools: () => void;
}) {
  // Same query key as the planning tools use, so the two share one cache
  // entry and a cold iCloud fetch only ever happens once per day view.
  const { data, isLoading } = useQuery<DayEvents>({
    queryKey: ["founder-focus-events", dateStr],
    queryFn: async () => {
      const fresh = (await founderFocusApi(`/events?date=${dateStr}`)) as DayEvents;
      writeCachedFocus(`events:${dateStr}`, fresh);
      return fresh;
    },
    placeholderData: () => readCachedFocus<DayEvents>(`events:${dateStr}`),
  });

  const now = nowMinutes();
  const events = data?.events ?? [];
  const allDay = events.filter(e => e.allDay);
  const timed = events
    .filter(e => !e.allDay)
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  return (
    <section className="rounded-3xl border border-border bg-card overflow-hidden">
      <header className="px-6 pt-6 pb-4 flex items-baseline gap-3">
        <CalendarDays className="w-7 h-7 text-primary self-center flex-shrink-0" />
        <h2 className="font-display font-bold text-2xl md:text-3xl">Diary</h2>
        {timed.length > 0 && (
          <span className="text-lg text-muted-foreground font-medium">
            {timed.length} {timed.length === 1 ? "thing" : "things"}
          </span>
        )}
        {isLoading && !data && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground ml-auto" />}
      </header>

      {allDay.length > 0 && (
        <div className="mx-6 mb-4 rounded-2xl bg-secondary/40 px-5 py-3.5">
          {allDay.map((e, i) => (
            <p key={i} className="text-lg md:text-xl font-semibold leading-snug">
              {e.title}
              <span className="text-base font-normal text-muted-foreground ml-2">all day</span>
            </p>
          ))}
        </div>
      )}

      <div className="px-4 pb-5 space-y-2">
        {timed.map((e, i) => (
          <DiaryRow key={`${e.startMin}-${e.title}-${i}`} event={e} now={now} isToday={isToday} />
        ))}

        {timed.length === 0 && allDay.length === 0 && (
          <p className="px-2 py-10 text-center text-xl md:text-2xl text-muted-foreground font-medium">
            {data?.calendarConfigured === false
              ? "Apple Calendar isn't connected yet."
              : "Nothing in the diary — the day is yours."}
          </p>
        )}
      </div>

      {data?.calendarConfigured === false && (
        <div className="px-6 pb-5">
          <button
            type="button"
            onClick={onOpenPlanningTools}
            className="text-base font-medium text-primary underline underline-offset-4 hover:no-underline"
          >
            Connect it in Planning tools
          </button>
        </div>
      )}
      {data?.calendarError && (
        <p className="px-6 pb-5 text-base text-amber-700 dark:text-amber-400">
          Apple Calendar unavailable: {data.calendarError}
        </p>
      )}
    </section>
  );
}

function DiaryRow({ event, now, isToday }: { event: CalEvent; now: number; isToday: boolean }) {
  const live = isToday && event.startMin <= now && now < event.endMin;
  const past = isToday && event.endMin <= now;
  const minsLeft = event.endMin - now;

  return (
    <div
      className={cn(
        "rounded-2xl px-4 py-4 flex flex-wrap items-baseline gap-x-4 gap-y-2 transition-colors",
        live && "bg-primary/10 ring-2 ring-primary/40",
        // Finished meetings keep the day's shape without competing for
        // attention — the same 30% dimming the station checklists use.
        past && "opacity-30",
        !live && !past && "hover:bg-secondary/30",
      )}
    >
      <span className="tabular-nums text-xl md:text-2xl font-bold w-[5.5rem] flex-shrink-0">
        {minToTime(event.startMin)}
      </span>
      <div className="flex-1 min-w-[12rem]">
        <p className="text-xl md:text-2xl font-semibold leading-snug break-words">{event.title}</p>
        <p className="text-base text-muted-foreground mt-1">
          until {minToTime(event.endMin)}
          <span className="mx-2">·</span>
          {event.calendar}
          {live && (
            <span className="ml-2 font-semibold text-primary">
              on now{minsLeft > 0 ? ` · ${minsLeft} min left` : ""}
            </span>
          )}
        </p>
      </div>
      {/* Narrow (iPad portrait, phones): the button takes its own line under
          the title rather than squeezing it into three. */}
      {event.joinUrl && (
        <div className="basis-full pl-[5.5rem] lg:basis-auto lg:pl-0 lg:ml-auto lg:self-center">
          <a
            href={event.joinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-5 py-3 text-base font-semibold",
              event.joinIsCall
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "border border-border text-muted-foreground hover:bg-secondary/50",
            )}
          >
            {event.joinIsCall ? <Video className="w-5 h-5" /> : <ExternalLink className="w-5 h-5" />}
            {event.joinIsCall ? "Join" : "Open link"}
          </a>
        </div>
      )}
    </div>
  );
}
