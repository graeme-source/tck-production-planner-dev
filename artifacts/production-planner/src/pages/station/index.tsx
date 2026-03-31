import React from "react";
import { useParams } from "wouter";
import { useGetProductionPlan, getGetProductionPlanQueryKey } from "@workspace/api-client-react";
import type { ProductionPlanDetail } from "@workspace/api-client-react";
import { Loader2, AlertTriangle, RotateCw } from "lucide-react";
import { StationLayout } from "./shared/station-layout";
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
import type { StationType } from "./shared/constants";

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
        return <MixingStation plan={plan} />;
      case "building_1":
        return <BuildingStation key="building_1" plan={plan} lineNumber={1} />;
      case "building_2":
        return <BuildingStation key="building_2" plan={plan} lineNumber={2} />;
      case "ovens":
        return <OvensStation plan={plan} />;
      case "wrapping":
        return <WrappingStation plan={plan} />;
      case "packing":
        return <PackingStation plan={plan} />;
      case "dough_prep":
        return <DoughPrepStation plan={plan} />;
      case "dough_sheeting":
        return <DoughSheetingStation plan={plan} />;
      case "prep":
        return <PrepHub planId={planId} planDate={plan.planDate} />;
      case "main_prep":
        return <MainPrepStation plan={plan} />;
      case "prep_bases":
        return <PrepBasesStation plan={plan} />;
      case "prep_meat":
        return <PrepMeatStation plan={plan} />;
      default:
        return <div className="text-center py-12 text-muted-foreground">Unknown station: {stationType}</div>;
    }
  };

  return (
    <StationLayout planId={planId} stationType={stationType} plan={plan}>
      <StationErrorBoundary key={stationType}>
        {stationContent()}
      </StationErrorBoundary>
    </StationLayout>
  );
}
