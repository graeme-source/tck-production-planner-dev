/**
 * A one-line title that wraps instead of sliding out of sight — for the
 * narrow docked panel, where a long title wouldn't fit an ordinary text box.
 * Grows with what's typed; Enter doesn't add a line (it saves, if given).
 */
import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export function GrowingTitle({ id, value, onChange, onBlur, onEnter, label, placeholder, className, autoFocus = false }: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  onEnter?: () => void;
  /** For a screen reader, when there's no visible label tied to `id`. */
  label?: string;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const lastWidth = useRef(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
    };
    fit();
    // The panel changing width (turning the iPad round) re-wraps it.
    const ro = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width;
      if (w === lastWidth.current) return;
      lastWidth.current = w;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [value]);
  useLayoutEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  return (
    <textarea
      ref={ref}
      id={id}
      rows={1}
      value={value}
      onChange={e => onChange(e.target.value.replace(/\s*\n\s*/g, " "))}
      onBlur={onBlur}
      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onEnter?.(); } }}
      placeholder={placeholder}
      aria-label={label}
      maxLength={300}
      className={cn("block resize-none overflow-hidden", className)}
    />
  );
}
