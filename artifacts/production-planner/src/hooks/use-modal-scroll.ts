/**
 * Scroll discipline for fixed-overlay modals (Graeme, 2026-09-07).
 *
 * Two things went wrong at the stations: focusing a modal's input made the
 * browser scroll the page BEHIND the overlay (iPad keyboard + autoFocus),
 * and when the modal closed the operator was left on a different recipe —
 * every batch, every time, on the ovens weight check.
 *
 * useModalScrollKeeper(open): remembers where the page was when the modal
 * opened and puts it back when it closes, whichever scroll world the page
 * lives in (layout container or window — see lib/scroll.ts).
 *
 * useNoScrollAutoFocus(active): focuses the returned ref without letting the
 * browser scroll anything, replacing the autoFocus attribute inside modals.
 */
import { useEffect, useRef } from "react";
import { appScrollContainer } from "@/lib/scroll";

export function useModalScrollKeeper(open: boolean = true) {
  const saved = useRef<{ y: number; container: boolean } | null>(null);
  useEffect(() => {
    if (!open) return;
    const el = appScrollContainer();
    saved.current = el ? { y: el.scrollTop, container: true } : { y: window.scrollY, container: false };
    // Restore on close OR unmount — modals here are conditionally rendered,
    // so components that ARE the modal just call this with no argument.
    return () => {
      if (saved.current == null) return;
      const { y, container } = saved.current;
      saved.current = null;
      // After the close re-render has settled, put the page back where the
      // operator left it.
      requestAnimationFrame(() => {
        const target = container ? appScrollContainer() : null;
        if (target) target.scrollTop = y;
        else if (!container) window.scrollTo({ top: y });
      });
    };
  }, [open]);
}

export function useNoScrollAutoFocus<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => ref.current?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(t);
  }, [active]);
  return ref;
}
