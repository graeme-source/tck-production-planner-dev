/**
 * The founder's Schedule page.
 *
 * Rebuilt 2026-09-18 (Graeme): "I want to make the UI a lot simpler and
 * easier, with just less stuff on there." So the page is now two things —
 * today's diary, and his own to-dos — at a size that reads at arm's length
 * on an iPad.
 *
 * Everything the page used to be (pillars, goals, recurring items, the
 * drag-and-resize timeline, the weekly template, the parking lot, the North
 * Star objectives and the Apple Calendar setup) is HIDDEN, not deleted: it
 * all still works, with all its data, inside <FounderPlanner /> behind the
 * "Planning tools" disclosure below. To make any of it the page again,
 * render that component straight into the layout here.
 */
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Redirect } from "wouter";
import { format, addDays, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight, ChevronDown, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { FounderNav } from "@/components/founder-nav";
import { FounderDiary } from "@/components/founder-diary";
import { FounderTodos } from "@/components/founder-todos";
import { FounderPlanner } from "@/components/founder-planner";
import { cn } from "@/lib/utils";

const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";

export default function FounderFocus() {
  const { state } = useAuth();
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [dateStr, setDateStr] = useState(todayStr);
  const [planningOpen, setPlanningOpen] = useState(false);

  // Re-render every minute so "on now" and the minutes-left track the clock.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (state.status !== "authenticated" || state.user.email !== FOUNDER_EMAIL) {
    return <Redirect to="/" />;
  }

  const isToday = dateStr === todayStr;
  const step = (days: number) => setDateStr(format(addDays(parseISO(dateStr), days), "yyyy-MM-dd"));

  return (
    <div className="space-y-6">
      <FounderNav />
      <PageHeader title="Schedule" description="Your day, and what you owe yourself." />

      {/* ── The day ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-3xl md:text-4xl leading-tight truncate">
            {isToday ? "Today" : format(parseISO(dateStr), "EEEE")}
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mt-0.5">
            {format(parseISO(dateStr), "EEEE d MMMM")}
            {!isToday && (
              <button
                onClick={() => setDateStr(todayStr)}
                className="ml-3 text-base text-primary underline underline-offset-4 hover:no-underline"
              >
                Back to today
              </button>
            )}
          </p>
        </div>
        <button
          onClick={() => step(-1)}
          className="p-3 rounded-xl border border-border text-muted-foreground hover:bg-secondary/50"
          aria-label="Previous day"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <button
          onClick={() => step(1)}
          className="p-3 rounded-xl border border-border text-muted-foreground hover:bg-secondary/50"
          aria-label="Next day"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      </div>

      <FounderDiary
        dateStr={dateStr}
        isToday={isToday}
        onOpenPlanningTools={() => setPlanningOpen(true)}
      />

      <FounderTodos />

      {/* ── Everything else, deliberately small and quiet ────────────────── */}
      <section className="max-w-2xl pt-2">
        <button
          type="button"
          onClick={() => setPlanningOpen(o => !o)}
          aria-expanded={planningOpen}
          className="w-full flex items-center gap-2 px-4 py-3 rounded-xl text-base text-muted-foreground hover:bg-secondary/40 transition-colors"
        >
          <Settings2 className="w-5 h-5" />
          Planning tools
          <span className="text-sm">— pillars, goals, time blocks, template, parking lot</span>
          <ChevronDown className={cn("w-5 h-5 ml-auto transition-transform", planningOpen && "rotate-180")} />
        </button>
        {/* Mounted only when opened: the overview and iCloud calls behind
            these tools shouldn't run for a section nobody is looking at. */}
        {planningOpen && (
          <div className="mt-4">
            <FounderPlanner />
          </div>
        )}
      </section>
    </div>
  );
}
