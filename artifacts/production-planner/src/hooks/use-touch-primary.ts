import { useEffect, useState } from "react";
import { isTouchPrimary } from "@/lib/edge-swipe";

function read(): { coarsePointer: boolean; canHover: boolean; anyFinePointer: boolean } {
  if (typeof window === "undefined" || !window.matchMedia) return { coarsePointer: false, canHover: true, anyFinePointer: true };
  return {
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    canHover: window.matchMedia("(hover: hover)").matches,
    anyFinePointer: window.matchMedia("(any-pointer: fine)").matches,
  };
}

/**
 * Is this a touch screen first (iPad, phone) rather than a mouse? Decided by
 * the pointer, not the width — iPad landscape is as wide as a laptop.
 * Follows changes (a trackpad keyboard clipped onto an iPad).
 */
export function usePointerKind(): { coarsePointer: boolean; canHover: boolean; anyFinePointer: boolean; touchPrimary: boolean } {
  const [kind, setKind] = useState(read);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mqs = [window.matchMedia("(pointer: coarse)"), window.matchMedia("(hover: hover)"), window.matchMedia("(any-pointer: fine)")];
    const on = () => setKind(read());
    mqs.forEach(m => m.addEventListener("change", on));
    return () => mqs.forEach(m => m.removeEventListener("change", on));
  }, []);
  return { ...kind, touchPrimary: isTouchPrimary(kind) };
}
