/**
 * Escape closes the calendar's pop-ups (phase, email, offers, re-use), like
 * the app's other modals. Only the topmost one listening reacts: each
 * registers on mount, and the newest gets the key.
 */
import { useEffect, useRef } from "react";

const stack: symbol[] = [];

export function useEscapeToClose(onClose: () => void) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    const id = Symbol("modal");
    stack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || stack[stack.length - 1] !== id) return;
      e.preventDefault();
      ref.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, []);
}
