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
  // The rows are stored WITH the key they were fetched for. Effects run
  // after render, so on a type switch the first paint used to hand the
  // PREVIOUS type's rows to the NEW type's renderer with loading=false —
  // which crashed any renderer that trusts its data shape (found live
  // 2026-08-20: desserts_report reading .products.length off batch-number
  // rows when flicking between packing checks). Deriving by key means a
  // renderer can never see another type's data; the gap reads as loading.
  const [state, setState] = useState<{ key: string | null; rows: unknown[] }>({ key: null, rows: [] });
  const [fetching, setFetching] = useState(false);
  const key = type ? `${planId}:${type}` : null;

  useEffect(() => {
    if (!key || !type) return;
    let cancelled = false;
    setFetching(true);
    fetch(`${BASE}/api/checklists/dynamic-data/${planId}/${encodeURIComponent(type)}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(d => { if (!cancelled) { setState({ key, rows: Array.isArray(d) ? d : [] }); setFetching(false); } })
      .catch(() => { if (!cancelled) setFetching(false); });
    return () => { cancelled = true; };
  }, [planId, type]);

  const fresh = key != null && state.key === key;
  return {
    data: fresh ? state.rows : [],
    loading: key != null && (fetching || !fresh),
  };
}
