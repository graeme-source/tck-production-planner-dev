import { useEffect, useState } from "react";
import { isTouchPrimary } from "@/lib/edge-swipe";

function read(): { coarsePointer: boolean; canHover: boolean } {
  if (typeof window === "undefined" || !window.matchMedia) return { coarsePointer: false, canHover: true };
  return {
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    canHover: window.matchMedia("(hover: hover)").matches,
  };
}

/**
 * Is this a touch screen first (iPad, phone) rather than a mouse? Decided by
 * the pointer, not the width — iPad landscape is as wide as a laptop.
 * Follows changes (a trackpad keyboard clipped onto an iPad).
 */
export function usePointerKind(): { coarsePointer: boolean; canHover: boolean; touchPrimary: boolean } {
  const [kind, setKind] = useState(read);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mqs = [window.matchMedia("(pointer: coarse)"), window.matchMedia("(hover: hover)")];
    const on = () => setKind(read());
    mqs.forEach(m => m.addEventListener("change", on));
    return () => mqs.forEach(m => m.removeEventListener("change", on));
  }, []);
  return { ...kind, touchPrimary: isTouchPrimary(kind) };
}
