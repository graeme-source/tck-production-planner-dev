/**
 * The combined save state of every autosaving field inside it (Graeme,
 * 2026-10-13 — the People review editor's pinned footer says "All changes
 * saved ✓" / "Saving…" / "Not saved — retry" for the whole form, not just
 * per field). Objective H. Each field still shows its own chip.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { AutosaveRegistryContext, type AutosaveRegistry, type AutosaveState } from "./use-autosave";
import { summariseSaveStates, type SaveSummary } from "@/lib/review-footer";

interface Summary { state: SaveSummary; retry: () => void }
const SummaryContext = createContext<Summary | null>(null);

export function AutosaveSummaryProvider({ children }: { children: ReactNode }) {
  const fields = useRef(new Map<symbol, { state: AutosaveState; flush: () => Promise<boolean> }>());
  const [state, setState] = useState<SaveSummary>("saved");
  const recompute = useCallback(() => {
    setState(summariseSaveStates(Array.from(fields.current.values(), f => f.state)));
  }, []);
  const registry = useMemo<AutosaveRegistry>(() => ({
    report(id, s, flush) { fields.current.set(id, { state: s, flush }); recompute(); },
    remove(id) { fields.current.delete(id); recompute(); },
  }), [recompute]);
  const retry = useCallback(() => {
    for (const f of fields.current.values()) if (f.state === "error") void f.flush();
  }, []);
  const summary = useMemo(() => ({ state, retry }), [state, retry]);
  return (
    <AutosaveRegistryContext.Provider value={registry}>
      <SummaryContext.Provider value={summary}>{children}</SummaryContext.Provider>
    </AutosaveRegistryContext.Provider>
  );
}

/** The combined state, or null outside an AutosaveSummaryProvider. */
export function useAutosaveSummary(): Summary | null {
  return useContext(SummaryContext);
}
