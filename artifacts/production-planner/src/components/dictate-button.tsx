/**
 * Dictate-and-tidy (Graeme, 2026-09-16).
 *
 * Typing on a shared iPad mid-production is slow enough that improvements
 * don't get written down. Tap the mic, say it however it comes out, tap to
 * stop — and the tidy-up happens BY ITSELF, because having to press a second
 * "polish" button defeats the point of it being quick.
 *
 * Non-negotiables baked in here:
 *  - The words are never lost. The raw transcript is in the box the moment
 *    it's heard; tidying only ever swaps it for a cleaner version, and
 *    "Undo tidy" puts the original straight back.
 *  - Tidying is punctuation, not authorship (see routes/dictation.ts). If
 *    the server is slow, unconfigured, or errors, the raw text just stays.
 *  - The button hides itself where speech recognition isn't available, so
 *    nobody taps a mic that can't work.
 */
import { useCallback, useRef, useState } from "react";
import { Mic, Square, Loader2, Undo2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVoiceInput } from "@/hooks/use-voice-input";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function DictateButton({ value, onChange, context = "note", className }: {
  value: string;
  onChange: (text: string) => void;
  /** "title" keeps it to one short line; "note" allows a sentence or two. */
  context?: "title" | "note";
  className?: string;
}) {
  const [polishing, setPolishing] = useState(false);
  const [rawBeforeTidy, setRawBeforeTidy] = useState<string | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const polish = useCallback(async (text: string) => {
    const raw = text.trim();
    if (!raw) return;
    setPolishing(true);
    try {
      const res = await fetch(`${BASE}/api/dictation/polish`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: raw, context }),
      });
      if (!res.ok) return;                       // raw text already in the box
      const data = await res.json() as { polished?: string; changed?: boolean };
      const polished = (data.polished ?? "").trim();
      if (!polished || polished === raw) return;
      setRawBeforeTidy(raw);
      onChange(polished);
    } catch {
      // Offline or server down — the dictated words stay exactly as spoken.
    } finally {
      setPolishing(false);
    }
  }, [context, onChange]);

  const { supported, listening, error, toggle } = useVoiceInput({
    onTranscript: onChange,
    onFinished: polish,
    mode: "append",
    getCurrentValue: () => valueRef.current,
  });

  if (!supported) return null;

  return (
    <span className={cn("inline-flex items-center gap-2 flex-wrap", className)}>
      <button
        type="button"
        onClick={() => { setRawBeforeTidy(null); toggle(); }}
        disabled={polishing}
        aria-label={listening ? "Stop dictating" : "Dictate"}
        className={cn(
          "inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold transition-colors disabled:opacity-60",
          listening
            ? "bg-red-500 text-white hover:bg-red-600 animate-pulse"
            : "border-2 border-border bg-card text-foreground hover:bg-secondary/60",
        )}
      >
        {polishing
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Tidying…</>
          : listening
            ? <><Square className="w-4 h-4" /> Stop</>
            : <><Mic className="w-4 h-4" /> Dictate</>}
      </button>

      {listening && (
        <span className="text-xs font-medium text-red-600 dark:text-red-400">Listening — just say it</span>
      )}

      {/* The escape hatch: one tap back to exactly what was said. */}
      {!listening && !polishing && rawBeforeTidy != null && (
        <button
          type="button"
          onClick={() => { onChange(rawBeforeTidy); setRawBeforeTidy(null); }}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground underline underline-offset-2"
        >
          <Undo2 className="w-3 h-3" /> Undo tidy
        </button>
      )}
      {!listening && !polishing && rawBeforeTidy != null && (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          <Sparkles className="w-3 h-3" /> tidied
        </span>
      )}

      {error && <span className="text-xs text-amber-600 dark:text-amber-400">{error}</span>}
    </span>
  );
}
