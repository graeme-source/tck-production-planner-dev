import React from "react";
import { useParams } from "wouter";
import { useGetProductionPlan, getGetProductionPlanQueryKey } from "@workspace/api-client-react";
import type { ProductionPlanDetail } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
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

export default function StationPage() {
  const params = useParams<{ planId: string; stationType: string }>();
  const planId = Number(params.planId);
  const stationType = params.stationType as StationType;

  const { data: plan, isLoading } = useGetProductionPlan(planId, {
    query: {
      queryKey: getGetProductionPlanQueryKey(planId),
      refetchInterval: 5000,
    },
  }) as {
    data: ProductionPlanDetail | undefined;
    isLoading: boolean;
  };

  if (isNaN(planId)) {
    return <div className="p-8 text-center text-muted-foreground">Invalid plan ID</div>;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading...
      </div>
    );
  }

  const stationContent = () => {
    if (!plan) return <div className="text-center py-12 text-muted-foreground">Plan not found</div>;

    switch (stationType) {
      case "mixing":
        return <MixingStation plan={plan} />;
      case "building_1":
        return <BuildingStation plan={plan} lineNumber={1} />;
      case "building_2":
        return <BuildingStation plan={plan} lineNumber={2} />;
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
      {stationContent()}
    </StationLayout>
  );
}
