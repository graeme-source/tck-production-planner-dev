/**
 * Which must-answer sign-in prompts are on screen right now, so a gentler
 * pop-up (the swipe-panel walkthrough) can wait its turn instead of sitting
 * underneath one. A tiny external store: a prompt reports itself with
 * useReportPromptShowing(key, showing); anything else reads
 * useAnyPromptShowing().
 */
import { useEffect, useState, useSyncExternalStore } from "react";

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

/**
 * Is ANY full-screen pop-up on screen — including the many that don't report
 * themselves above (new to-do, station messages, team messages…)? Found on
 * 2026-10-09: the walkthrough sat on top of the "New to-do for you" pop-up.
 * The app's modals are all a fixed, viewport-covering backdrop, so: is the
 * thing at the centre of the screen inside a fixed element that covers
 * nearly the whole viewport — or is a Radix dialog open? Checked once a
 * second while `enabled`.
 * (elementFromPoint skips pointer-events:none layers, so a closed swipe
 * panel's backdrop never counts.)
 */
export function fullScreenOverlayShowing(): boolean {
  if (typeof document === "undefined") return false;
  // Radix/shadcn dialogs: the card is a small fixed box and the dimmed
  // overlay is a SIBLING, so the centre-of-screen walk below misses them
  // (seen with the building station's Edit numbers dialog). They mark
  // themselves open.
  if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return true;
  const vw = window.innerWidth, vh = window.innerHeight;
  let el: Element | null = document.elementFromPoint(vw / 2, vh / 2);
  while (el && el !== document.body) {
    const cs = getComputedStyle(el);
    if (cs.position === "fixed") {
      const r = el.getBoundingClientRect();
      if (r.width >= vw * 0.9 && r.height >= vh * 0.9) return true;
    }
    el = el.parentElement;
  }
  return false;
}

export function useFullScreenOverlayShowing(enabled: boolean): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!enabled) { setOn(false); return; }
    const tick = () => setOn(fullScreenOverlayShowing());
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [enabled]);
  return on;
}
