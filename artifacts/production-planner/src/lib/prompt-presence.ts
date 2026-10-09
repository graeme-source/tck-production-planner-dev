/**
 * Which must-answer sign-in prompts are on screen right now, so a gentler
 * pop-up (the swipe-panel walkthrough) can wait its turn instead of sitting
 * underneath one. A tiny external store: a prompt reports itself with
 * useReportPromptShowing(key, showing); anything else reads
 * useAnyPromptShowing().
 */
import { useEffect, useSyncExternalStore } from "react";

const showing = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function set(key: string, on: boolean): void {
  const had = showing.has(key);
  if (on === had) return;
  if (on) showing.add(key); else showing.delete(key);
  version++;
  listeners.forEach(l => l());
}

export function useReportPromptShowing(key: string, on: boolean): void {
  useEffect(() => {
    set(key, on);
    return () => set(key, false);
  }, [key, on]);
}

export function useAnyPromptShowing(): boolean {
  useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb); },
    () => version,
  );
  return showing.size > 0;
}
