import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2, Boxes, Snowflake, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import {
  ProductionPlanSlide,
  fetchDashboard,
  type MeetingSlide,
  type PackStockMode,
} from "./meeting";

// Standalone view of the morning meeting's combined production + shortage
// table ("Order of Production" slide), reachable any time from the
// dashboard's Factory Number tile. Shows, per recipe, what's in the fridge
// vs what the next dispatch needs — red = short, amber = tight — without
// having to start a meeting.

// After 3pm London the slide flips to tomorrow's dispatch (see
// ProductionPlanSlide), so the page title follows suit.
function isAfter3pmLondon(): boolean {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(new Date()),
  ) >= 15;
}

function reportSlide(): MeetingSlide {
  return {
    id: 0,
    kind: "short_on_pack",
    title: `${isAfter3pmLondon() ? "Tomorrow's" : "Today's"} Pack — Stock vs Dispatch`,
    orderPosition: 0,
    contentMd: null,
    configJson: null,
  };
}

export default function PackReport() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["morning-meeting-dashboard"],
    queryFn: fetchDashboard,
    staleTime: 30_000,
  });

  // Defaults to "actual" — the team packs from what's physically in the fridge,
  // and that is what this report has always shown. "Predicted" is opt-in for
  // whoever is thinking a day ahead (e.g. sizing tomorrow's plan).
  const [stockMode, setStockMode] = useState<PackStockMode>("actual");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pack Report"
        description={stockMode === "predicted"
          ? "Predicted end-of-day stock vs the next dispatch — includes what's still to wrap"
          : "The morning-meeting table: fridge stock vs the next dispatch, red where we're short"}
        action={
          <Link href="/stock-control">
            <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-2 hover:bg-secondary transition-colors">
              <Boxes className="w-3.5 h-3.5" />
              Stock Control
            </button>
          </Link>
        }
      />

      {/* Which stock figure the table's first column shows. Two different
          questions: "what can I pack right now" vs "where do we land tonight". */}
      <div className="flex flex-wrap items-center gap-2">
        {([
          {
            key: "actual" as const,
            label: "In the fridge now",
            icon: Snowflake,
            hint: "What's physically counted in the fridge — pack from this.",
          },
          {
            key: "predicted" as const,
            label: "Predicted end of day",
            icon: TrendingUp,
            hint: "Adds what wrapping still has to push in, less what fulfilment still has to pull out.",
          },
        ]).map(opt => {
          const Icon = opt.icon;
          const active = stockMode === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => setStockMode(opt.key)}
              title={opt.hint}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <Icon className="w-4 h-4" />
              {opt.label}
            </button>
          );
        })}
        {stockMode === "predicted" && (
          <p className="text-xs text-muted-foreground ml-1">
            Forecast — not what you can pack from right now.
          </p>
        )}
      </div>

      {isLoading || !data ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          {error ? (
            <p className="text-sm">Failed to load the pack report. Please refresh.</p>
          ) : (
            <>
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm">Loading pack report…</span>
            </>
          )}
        </div>
      ) : (
        // The slide's type scale is sized for the meeting-room TV; shrink it
        // here so recipe names fit an iPad in portrait without touching the
        // shared component.
        <div className="[&_.text-2xl]:text-lg [&_.text-4xl]:text-2xl">
          <ProductionPlanSlide data={data} slide={reportSlide()} isPreviewing={false} stockMode={stockMode} />
        </div>
      )}
    </div>
  );
}
