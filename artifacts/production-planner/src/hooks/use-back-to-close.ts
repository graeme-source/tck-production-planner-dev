/**
 * The browser's Back — and the iPad/trackpad swipe that does the same —
 * closes the open pop-up instead of leaving the page (Graeme, 24 Nov 2026:
 * "I accidentally swiped left and went back out of this modal, and I lost
 * all my changes"). While `open`, one extra history entry (same URL) sits
 * on top; Back lands on it, the page stays, and `onBack` decides — close,
 * or ask about unsaved changes first. Closing normally takes the extra
 * entry back off, unless the pop-up was left by going to another page.
 */
import { useEffect, useRef } from "react";

const KEY = "tckPopupGuard";

export function useBackToClose(open: boolean, onBack: () => void): void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const marker = `${Date.now()}-${Math.random()}`;
    const arm = () => window.history.pushState({ ...(window.history.state ?? {}), [KEY]: marker }, "");
    arm();
    const onPop = (e: PopStateEvent) => {
      // Still on (another) guarded entry: not a Back out of this pop-up.
      if ((e.state as Record<string, unknown> | null)?.[KEY] != null) return;
      arm(); // stay put; the pop-up decides what Back means
      onBackRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if ((window.history.state as Record<string, unknown> | null)?.[KEY] === marker) window.history.back();
    };
  }, [open]);
}
