/**
 * Autosave with a visible state (charter rule 5: every data-entry field
 * autosaves or shows an unmissable save state; silent failures are banned).
 *
 *   const auto = useAutosave(v => patch(v));
 *   onChange → auto.schedule(next)   saves ~0.8s after typing stops
 *   onBlur   → auto.flush()          saves now
 *   <SaveChip state={auto.state} error={auto.error} onRetry={auto.flush} />
 *
 * A failed save keeps the value pending, shows the error and offers Retry.
 * If the component unmounts with something unsaved (a quick tap away, the
 * modal closed), the save still goes out — the typed value is never lost.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type AutosaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export function useAutosave<T>(save: (value: T) => Promise<unknown>, delay = 800) {
  const [state, setState] = useState<AutosaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ value: T } | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const p = pending.current;
    if (!p) return true;
    pending.current = null;
    setState("saving");
    try {
      await saveRef.current(p.value);
      setState(pending.current ? "dirty" : "saved");
      setError(null);
      return true;
    } catch (err) {
      pending.current = pending.current ?? p;
      setState("error");
      setError(err instanceof Error ? err.message : "Couldn't save");
      return false;
    }
  }, []);

  const schedule = useCallback((value: T) => {
    pending.current = { value };
    setState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), delay);
  }, [flush, delay]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    const p = pending.current;
    if (p) saveRef.current(p.value).catch(err => console.error("[autosave] save on leave failed:", err));
  }, []);

  return { state, error, schedule, flush, hasPending: () => pending.current != null };
}
