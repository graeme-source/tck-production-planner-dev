import { useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { useFeatureFlags } from "./use-feature-flags";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Assignment {
  userId: number;
  userName: string;
}

interface StationAssignmentResult {
  /** Which building station the current user is assigned to (null if not assigned) */
  myAssignment: "building_1" | "building_2" | null;
  /** All building station assignments for this plan */
  assignments: { building_1: Assignment | null; building_2: Assignment | null };
  /** True if the user is trying to access a building station assigned to someone else */
  isBlocked: boolean;
  /** Name of the user who is assigned to the station being viewed (when blocked) */
  assignedUserName: string | null;
  /** True while loading */
  isLoading: boolean;
  /** True if the feature is enabled */
  enabled: boolean;
}

function assignmentKey(planId: number, station: string) {
  return `station_assignment_${planId}_${station}`;
}

export function useStationAssignment(planId: number, stationType: string): StationAssignmentResult {
  const { state } = useAuth();
  const { buildingStationLock } = useFeatureFlags();
  const queryClient = useQueryClient();
  const assigningRef = useRef(false);

  const userId = state.status === "authenticated" ? state.user.id : 0;
  const userName = state.status === "authenticated" ? state.user.name : "";
  const isAdmin = state.status === "authenticated" && state.user.role === "admin";
  const isBuilding = stationType === "building_1" || stationType === "building_2";

  const { data, isLoading } = useQuery({
    queryKey: ["station-assignments", planId],
    queryFn: async () => {
      const k1 = assignmentKey(planId, "building_1");
      const k2 = assignmentKey(planId, "building_2");
      const [r1, r2] = await Promise.all([
        fetch(`${BASE}/api/app-settings/${k1}`, { credentials: "include" }).then(r => r.ok ? r.json() : null),
        fetch(`${BASE}/api/app-settings/${k2}`, { credentials: "include" }).then(r => r.ok ? r.json() : null),
      ]);
      return {
        building_1: r1?.value ? (JSON.parse(r1.value) as Assignment) : null,
        building_2: r2?.value ? (JSON.parse(r2.value) as Assignment) : null,
      };
    },
    enabled: buildingStationLock && userId > 0,
    staleTime: 5_000,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  const assignments = data ?? { building_1: null, building_2: null };

  // Determine current user's assignment
  let myAssignment: "building_1" | "building_2" | null = null;
  if (assignments.building_1?.userId === userId) myAssignment = "building_1";
  else if (assignments.building_2?.userId === userId) myAssignment = "building_2";

  // Auto-assign: if feature enabled, user is on a building station, not yet assigned anywhere,
  // and the station they're viewing is unassigned — claim it
  const assign = useCallback(async (station: "building_1" | "building_2") => {
    if (assigningRef.current) return;
    assigningRef.current = true;
    try {
      const key = assignmentKey(planId, station);
      const value = JSON.stringify({ userId, userName });
      await fetch(`${BASE}/api/app-settings/${key}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      queryClient.invalidateQueries({ queryKey: ["station-assignments", planId] });
    } catch (err) {
      console.warn("[StationAssignment] Auto-assign failed:", err);
    } finally {
      assigningRef.current = false;
    }
  }, [planId, userId, userName, queryClient]);

  useEffect(() => {
    if (!buildingStationLock || !isBuilding || isLoading || !data || userId === 0) return;
    if (myAssignment !== null) return; // already assigned somewhere
    const station = stationType as "building_1" | "building_2";
    if (assignments[station] === null) {
      // Station is unassigned — claim it
      assign(station);
    }
  }, [buildingStationLock, isBuilding, isLoading, data, userId, myAssignment, stationType, assignments, assign]);

  // Determine if blocked
  const isBlocked = (() => {
    if (!buildingStationLock || !isBuilding || isAdmin) return false;
    const station = stationType as "building_1" | "building_2";
    const stationAssignment = assignments[station];
    if (!stationAssignment) return false;
    return stationAssignment.userId !== userId;
  })();

  const assignedUserName = (() => {
    if (!isBuilding) return null;
    const station = stationType as "building_1" | "building_2";
    const stationAssignment = assignments[station];
    if (!stationAssignment || stationAssignment.userId === userId) return null;
    return stationAssignment.userName;
  })();

  return {
    myAssignment,
    assignments,
    isBlocked,
    assignedUserName,
    isLoading,
    enabled: buildingStationLock,
  };
}
