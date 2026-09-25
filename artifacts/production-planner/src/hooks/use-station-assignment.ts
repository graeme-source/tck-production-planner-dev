import { useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { useFeatureFlags } from "./use-feature-flags";
import {
  blockedBy,
  buildingTableStatus,
  shouldRecordOpen,
  type BuildingTableFacts,
  type BuildingTableStatus,
} from "@/lib/building-table-status";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type TableKey = "building_1" | "building_2";

interface StationAssignmentResult {
  /** Who is on each building table right now and what the chooser says —
   *  lib/building-table-status.ts (the latest batch recorder wins over
   *  whoever merely opened the screen). */
  tables: Record<TableKey, BuildingTableStatus>;
  /** True if the building lock is on and someone else is working this table */
  isBlocked: boolean;
  /** Name of whoever is working the table being viewed (when it isn't you) */
  assignedUserName: string | null;
  /** True while loading */
  isLoading: boolean;
  /** True if the building lock feature is enabled */
  enabled: boolean;
}

function assignmentKey(planId: number, station: string) {
  return `station_assignment_${planId}_${station}`;
}

export function useStationAssignment(planId: number, stationType: string): StationAssignmentResult {
  const { state, pinLocked } = useAuth();
  const { buildingStationLock } = useFeatureFlags();
  const queryClient = useQueryClient();
  const assigningRef = useRef(false);

  const userId = state.status === "authenticated" ? state.user.id : 0;
  const userName = state.status === "authenticated" ? state.user.name : "";
  const isAdmin = state.status === "authenticated" && state.user.role === "admin";
  const isBuilding = stationType === "building_1" || stationType === "building_2";

  // Presence is recorded and read REGARDLESS of the lock flag (Graeme,
  // 2026-09-16): the chooser shows who is on a table so the next person
  // picks the other one. Only the blocking below is gated by the flag.
  const { data, isLoading } = useQuery({
    queryKey: ["building-tables", planId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/building-tables/${planId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`building-tables ${res.status}`);
      const body = await res.json() as { tables: Record<TableKey, BuildingTableFacts> };
      return body.tables;
    },
    enabled: userId > 0 && planId > 0,
    staleTime: 5_000,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  const now = Date.now();
  const tables: Record<TableKey, BuildingTableStatus> = {
    building_1: buildingTableStatus(data?.building_1, now, userId),
    building_2: buildingTableStatus(data?.building_2, now, userId),
  };

  // Opening a building table records you as its opener — a hint for the
  // chooser ("Opened by X at 06:03"), never a claim to be "the" builder.
  // That write is one the server refuses while today's PIN is due, so a
  // stale overnight session opening a table gets the PIN pad instead.
  const recordOpen = useCallback(async (station: TableKey) => {
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
      queryClient.invalidateQueries({ queryKey: ["building-tables", planId] });
    } catch (err) {
      console.warn("[StationAssignment] Recording the table open failed:", err);
    } finally {
      assigningRef.current = false;
    }
  }, [planId, userId, userName, queryClient]);

  const viewed = isBuilding ? (stationType as TableKey) : null;
  const other: TableKey | null = viewed === "building_1" ? "building_2" : viewed === "building_2" ? "building_1" : null;
  const wantsOpen = viewed != null && other != null && !isLoading && data != null
    && shouldRecordOpen({ facts: data[viewed], status: tables[viewed] }, tables[other], userId);

  // Not while the PIN pad is up; once it's cleared (same person or whoever
  // switched in) the open is recorded under the right name.
  useEffect(() => {
    if (wantsOpen && viewed && !pinLocked) recordOpen(viewed);
  }, [wantsOpen, viewed, pinLocked, recordOpen]);

  const assignedUserName = viewed ? blockedBy(tables[viewed], userId) : null;
  // Blocking stays opt-in behind the flag, and now follows whoever is
  // actually working the table (a batch in the last 30 minutes, or a fresh
  // open with no batch since) — a morning open no longer locks a table all day.
  const isBlocked = buildingStationLock && !isAdmin && assignedUserName != null;

  return {
    tables,
    isBlocked,
    assignedUserName,
    isLoading,
    enabled: buildingStationLock,
  };
}
