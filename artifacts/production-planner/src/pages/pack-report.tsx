import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2, Boxes } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import {
  ProductionPlanSlide,
  fetchDashboard,
  type MeetingSlide,
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pack Report"
        description="The morning-meeting table: fridge stock vs the next dispatch, red where we're short"
        action={
          <Link href="/stock-control">
            <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-2 hover:bg-secondary transition-colors">
              <Boxes className="w-3.5 h-3.5" />
              Stock Control
            </button>
          </Link>
        }
      />

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
          <ProductionPlanSlide data={data} slide={reportSlide()} isPreviewing={false} />
        </div>
      )}
    </div>
  );
}
