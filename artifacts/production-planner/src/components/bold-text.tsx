// Bold in improvement notes (fix-queue #355). One renderer for every place an
// improvement's notes are shown, and one B button for every notes box. The
// rule itself lives in lib/bold-text.ts.
//
// Bold is built from React nodes — never dangerouslySetInnerHTML — so a note
// can't inject markup. Plain notes come back as the same string as before, so
// whitespace-pre-wrap and line-clamp on the parent behave exactly as they did.
import type { RefObject } from "react";
import { Bold } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseBold, hasBold, wrapBold } from "@/lib/bold-text";

export function BoldText({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  if (!hasBold(text)) return <>{text}</>;
  return (
    <>
      {parseBold(text).map((seg, i) =>
        seg.bold ? <strong key={i} className="font-bold">{seg.text}</strong> : <span key={i}>{seg.text}</span>,
      )}
    </>
  );
}

/**
 * Big B button that sits beside a notes box. Select some words, tap B, and
 * they go bold. Nothing selected: the next words typed are bold.
 */
export function BoldButton({ textareaRef, value, onChange, className }: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (text: string) => void;
  className?: string;
}) {
  const apply = () => {
    const el = textareaRef.current;
    const start = el ? el.selectionStart : value.length;
    const end = el ? el.selectionEnd : value.length;
    const r = wrapBold(value, start, end);
    onChange(r.value);
    // Put the cursor/selection back once React has written the new value.
    requestAnimationFrame(() => {
      const t = textareaRef.current;
      if (!t) return;
      t.focus();
      t.setSelectionRange(r.selectionStart, r.selectionEnd);
    });
  };
  return (
    <button
      type="button"
      // Keep the box's selection: don't let the tap steal focus first.
      onPointerDown={e => e.preventDefault()}
      onMouseDown={e => e.preventDefault()}
      onClick={apply}
      aria-label="Make the selected words bold"
      title="Bold — select words, then tap"
      className={cn(
        "inline-flex items-center justify-center gap-1.5 h-12 min-w-12 px-4 rounded-xl border-2 border-border bg-card text-base font-bold hover:bg-secondary/50 active:scale-95 transition-all",
        className,
      )}
    >
      <Bold className="w-5 h-5" strokeWidth={3} /> Bold
    </button>
  );
}
