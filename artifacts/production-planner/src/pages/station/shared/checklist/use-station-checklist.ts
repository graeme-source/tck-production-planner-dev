import { useState, useEffect, useRef, useCallback } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface ChecklistItem {
  type: "template" | "oneoff";
  id: number;
  title: string;
  description: string | null;
  dynamicDataType: string | null;
  schedule: string;
  scheduleDays: string | null;
  completed: boolean;
  completedBy: string | null;
  completedAt: string | null;
  completionId: number | null;
  notes: string | null;
  skippedReason: string | null;
}

export interface ChecklistData {
  planStatus: string;
  categories: Record<string, ChecklistItem[]>;
  summary: { total: number; done: number };
}

export function useStationChecklist(stationType: string, planId: number) {
  const [data, setData] = useState<ChecklistData | null>(null);
  const [loading, setLoading] = useState(true);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async (isInitial = false) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    if (isInitial) setLoading(true);
    try {
      const res = await fetch(
        `${BASE}/api/checklists/station/${encodeURIComponent(stationType)}/plan/${planId}`,
        { credentials: "include", signal: controller.signal },
      );
      if (!res.ok || !mountedRef.current) return;
      const json = await res.json();
      if (mountedRef.current) {
        setData(json);
        setLoading(false);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (mountedRef.current && isInitial) setLoading(false);
    }
  }, [stationType, planId]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData(true);
    const interval = setInterval(() => fetchData(false), 5000);
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      clearInterval(interval);
    };
  }, [fetchData]);

  return { data, loading, refetch: () => fetchData(false) };
}

export function useDynamicData(planId: number, type: string | null) {
  const [data, setData] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!type) { setData([]); return; }
    let cancelled = false;
    setLoading(true);
    fetch(`${BASE}/api/checklists/dynamic-data/${planId}/${encodeURIComponent(type)}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [planId, type]);

  return { data, loading };
}
