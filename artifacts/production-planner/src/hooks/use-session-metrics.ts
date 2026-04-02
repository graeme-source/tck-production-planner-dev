import { useState, useEffect, useCallback } from "react";

/**
 * Persists session metrics (batches completed, start time, break minutes)
 * in sessionStorage so they survive page reloads but reset on new browser sessions.
 *
 * Usage:
 *   const metrics = useSessionMetrics(planId, stationType);
 *   // metrics.sessionBatches, metrics.addBatch(), metrics.undoBatch()
 *   // metrics.sessionStartedAt
 *   // metrics.totalBreakMinutes, metrics.addBreakMinutes(n)
 */
export function useSessionMetrics(planId: number, stationType: string) {
  const key = `tck_session_${planId}_${stationType}`;

  const loadStored = (): { batches: number; startedAt: string; breakMinutes: number } => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore parse errors */ }
    return { batches: 0, startedAt: new Date().toISOString(), breakMinutes: 0 };
  };

  const [state, setState] = useState(loadStored);

  // Persist to sessionStorage on every change
  useEffect(() => {
    try { sessionStorage.setItem(key, JSON.stringify(state)); } catch { /* quota exceeded */ }
  }, [key, state]);

  const addBatch = useCallback(() => {
    setState(prev => ({ ...prev, batches: prev.batches + 1 }));
  }, []);

  const undoBatch = useCallback(() => {
    setState(prev => ({ ...prev, batches: Math.max(0, prev.batches - 1) }));
  }, []);

  const addBreakMinutes = useCallback((minutes: number) => {
    setState(prev => ({ ...prev, breakMinutes: prev.breakMinutes + minutes }));
  }, []);

  return {
    sessionBatches: state.batches,
    sessionStartedAt: state.startedAt,
    totalBreakMinutes: state.breakMinutes,
    addBatch,
    undoBatch,
    addBreakMinutes,
  };
}
