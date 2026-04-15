import React, { useState, useMemo, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useGetProductionPlan, getGetProductionPlanQueryKey } from "@workspace/api-client-react";
import type { ProductionPlanDetail } from "@workspace/api-client-react";
import { Loader2, AlertTriangle, RotateCw, ClipboardCheck, Factory, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import { StationLayout } from "./shared/station-layout";
import { StationChecklist } from "./shared/checklist/station-checklist";
import { MixingStation } from "./stations/mixing-station";
import { BuildingStation } from "./stations/building-station";
import { OvensStation } from "./stations/ovens-station";
import { WrappingStation } from "./stations/wrapping-station";
import { PackingStation } from "./stations/packing-station";
import { DoughPrepStation } from "./stations/dough-prep-station";
import { DoughSheetingStation } from "./stations/dough-sheeting-station";
import { PrepHub } from "./stations/prep-hub";
import { MainPrepStation } from "./stations/main-prep-station";
import { PrepBasesStation } from "./stations/prep-bases-station";
import { PrepMeatStation } from "./stations/prep-meat-station";
import { MacaroniCheeseStation } from "./stations/macaroni-cheese-station";
import type { StationType } from "./shared/constants";
import { useStationAssignment } from "@/hooks/use-station-assignment";

type StationView = "production" | "checklist";

/** Determine the default view and checklist category based on time of day and plan status */
function getDefaultView(planStatus?: string): { view: StationView; category: "opening" | "cleaning" | "closing" } {
  const hour = new Date().getHours();
  // Before 10am → show opening checks
  if (hour < 10) return { view: "checklist", category: "opening" };
  // After 4pm or plan complete → show closing/cleaning checks
  if (hour >= 16 || planStatus === "complete") return { view: "checklist", category: "closing" };
  // During production hours → show production
  return { view: "production", category: "opening" };
}

class StationErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <AlertTriangle className="w-10 h-10 text-amber-500" />
          <h2 className="text-lg font-semibold">Something went wrong</h2>
          <p className="text-sm text-muted-foreground max-w-md">
            {this.state.error?.message ?? "An unexpected error occurred."}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
          >
            <RotateCw className="w-4 h-4" />
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function StationPage() {
  const params = useParams<{ planId: string; stationType: string }>();
  const planId = Number(params.planId);
  const stationType = params.stationType as StationType;
  const { checklists: checklistsEnabled } = useFeatureFlags();

  const { data: plan, isLoading, error, refetch } = useGetProductionPlan(planId, {
    query: {
      queryKey: getGetProductionPlanQueryKey(planId),
      refetchInterval: 5000,
      placeholderData: (prev: ProductionPlanDetail | undefined) => prev,
    },
  }) as {
    data: ProductionPlanDetail | undefined;
    isLoading: boolean;
    error: Error | null;
    refetch: () => void;
  };

  const [isOnBreak, setIsOnBreak] = useState(false);
  const handleBreakActiveChange = useCallback((active: boolean) => setIsOnBreak(active), []);
  const [, navigate] = useLocation();
  const { isBlocked, assignedUserName } = useStationAssignment(planId, stationType);

  // Compute default view based on time of day and plan status
  const defaults = useMemo(
    () => getDefaultView(plan?.status),
    [plan?.status],
  );

  const [activeView, setActiveView] = useState<StationView>(
    checklistsEnabled ? defaults.view : "production",
  );

  // If feature gets toggled off while on checklist view, switch back
  if (!checklistsEnabled && activeView === "checklist") {
    setActiveView("production");
  }

  if (isNaN(planId)) {
    return <div className="p-8 text-center text-muted-foreground">Invalid plan ID</div>;
  }

  if (isLoading && !plan) {
    return (
      <div className="flex items-center justify-center min-h-screen text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading...
      </div>
    );
  }

  if (error && !plan) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 text-center px-4">
        <AlertTriangle className="w-10 h-10 text-amber-500" />
        <h2 className="text-lg font-semibold">Failed to load production plan</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          {error.message || "Could not connect to the server. Check your network connection."}
        </p>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <RotateCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    );
  }

  const stationContent = () => {
    if (!plan) return <div className="text-center py-12 text-muted-foreground">Plan not found</div>;

    switch (stationType) {
      case "mixing":
        return <MixingStation plan={plan} isOnBreak={isOnBreak} />;
      case "building_1":
        return <BuildingStation key="building_1" plan={plan} lineNumber={1} isOnBreak={isOnBreak} />;
      case "building_2":
        return <BuildingStation key="building_2" plan={plan} lineNumber={2} isOnBreak={isOnBreak} />;
      case "ovens":
        return <OvensStation plan={plan} isOnBreak={isOnBreak} />;
      case "wrapping":
        return <WrappingStation plan={plan} isOnBreak={isOnBreak} />;
      case "packing":
        return <PackingStation plan={plan} />;
      case "macaroni_cheese":
        return <MacaroniCheeseStation plan={plan} isOnBreak={isOnBreak} />;
      case "dough_prep":
        return <DoughPrepStation plan={plan} isOnBreak={isOnBreak} />;
      case "dough_sheeting":
        return <DoughSheetingStation plan={plan} isOnBreak={isOnBreak} />;
      case "prep":
        return <PrepHub planId={planId} planDate={plan.planDate} />;
      case "main_prep":
        return <MainPrepStation plan={plan} isOnBreak={isOnBreak} />;
      case "prep_bases":
        return <PrepBasesStation plan={plan} isOnBreak={isOnBreak} />;
      case "prep_meat":
        return <PrepMeatStation plan={plan} isOnBreak={isOnBreak} />;
      default:
        return <div className="text-center py-12 text-muted-foreground">Unknown station: {stationType}</div>;
    }
  };

  return (
    <StationLayout planId={planId} stationType={stationType} plan={plan} onBreakActiveChange={handleBreakActiveChange}>
      {/* View toggle — only shown when checklists feature is enabled */}
      {checklistsEnabled && (
        <div className="flex items-center gap-1 mb-4 p-1 bg-secondary/40 rounded-xl w-fit">
          <button
            onClick={() => setActiveView("checklist")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              activeView === "checklist"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <ClipboardCheck className="w-4 h-4" />
            Checklist
          </button>
          <button
            onClick={() => setActiveView("production")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              activeView === "production"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Factory className="w-4 h-4" />
            Production
          </button>
        </div>
      )}

      {isBlocked ? (
        <div className="flex flex-col items-center justify-center py-20 gap-6 text-center px-4">
          <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <Lock className="w-8 h-8 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold">Station Assigned</h2>
            <p className="text-muted-foreground max-w-sm">
              This station is assigned to <span className="font-semibold text-foreground">{assignedUserName}</span> for today's production.
            </p>
          </div>
          <button
            onClick={() => navigate(`/plans/${planId}/station/${stationType === "building_1" ? "building_2" : "building_1"}`)}
            className="px-6 py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Go to {stationType === "building_1" ? "Building Table 2" : "Building Table 1"}
          </button>
        </div>
      ) : (
        <StationErrorBoundary key={`${stationType}-${activeView}`}>
          {activeView === "checklist" && checklistsEnabled ? (
            <StationChecklist
              stationType={stationType}
              planId={planId}
              defaultCategory={defaults.category}
            />
          ) : (
            stationContent()
          )}
        </StationErrorBoundary>
      )}
    </StationLayout>
  );
}
