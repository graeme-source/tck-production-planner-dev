/**
 * Dictate a NUMBER into a field (Graeme, 19 Oct 2026: "always have a
 * dictate button on station text/number entry"). Objective F.
 *
 * The same speech engine as the dictate-and-tidy button (useVoiceInput,
 * lib/dictation-support.ts), but with no AI tidy: what's heard goes through
 * parseSpokenNumber ("five hundred and fifty" → 550, "12 point 4" → 12.4)
 * and only a number it can read fills the box. Anything else leaves the box
 * alone and says what it heard. Like DictateButton, it never hides — where
 * the browser can't listen, tapping it says what to use instead.
 */
import { useCallback, useState } from "react";
import { Mic, MicOff, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { parseSpokenNumber } from "@/lib/spoken-number";

export function DictateNumberButton({ onNumber, className }: {
  /** Called with each number heard (interim results too, so the box
   *  follows the speech). */
  onNumber: (n: number) => void;
  className?: string;
}) {
  const [heard, setHeard] = useState<string | null>(null);
  const [showTip, setShowTip] = useState(false);

  const onTranscript = useCallback((text: string) => {
    setHeard(text);
    const n = parseSpokenNumber(text);
    if (n != null) onNumber(n);
  }, [onNumber]);

  const { capability, listening, error, toggle } = useVoiceInput({
    onTranscript,
    mode: "replace",
  });

  const base = "w-full min-h-[56px] rounded-2xl text-lg font-bold inline-flex items-center justify-center gap-2 transition-colors";

  if (capability.mode === "unavailable") {
    return (
      <div className={cn("space-y-1", className)}>
        <button
          type="button"
          onClick={() => setShowTip(s => !s)}
          aria-expanded={showTip}
          className={cn(base, "border-2 border-dashed border-border bg-card text-muted-foreground hover:bg-secondary/60")}
        >
          <MicOff className="w-6 h-6" /> Dictate the number
        </button>
        {showTip && <p role="status" className="text-sm font-medium text-amber-700 dark:text-amber-300">{capability.tip}</p>}
      </div>
    );
  }

  const unreadable = !listening && heard != null && heard.trim() !== "" && parseSpokenNumber(heard) == null;

  return (
    <div className={cn("space-y-1", className)}>
      <button
        type="button"
        onClick={() => { setHeard(null); toggle(); }}
        aria-label={listening ? "Stop dictating" : "Dictate the number"}
        className={cn(
          base,
          listening
            ? "bg-red-500 text-white hover:bg-red-600 animate-pulse"
            : "border-2 border-border bg-card text-foreground hover:bg-secondary/60",
        )}
      >
        {listening
          ? <><Square className="w-6 h-6" /> Stop — I&rsquo;ve said it</>
          : <><Mic className="w-6 h-6" /> Dictate the number</>}
      </button>
      {listening && <p className="text-sm font-medium text-center text-red-600 dark:text-red-400">Listening — say the number, e.g. &ldquo;five hundred and fifty&rdquo;</p>}
      {unreadable && (
        <p role="alert" className="text-sm font-medium text-amber-700 dark:text-amber-300">
          Heard &ldquo;{heard}&rdquo; — that isn&rsquo;t a number I can read. Try again or type it.
        </p>
      )}
      {error && <p role="alert" className="text-sm font-medium text-amber-700 dark:text-amber-300">{error}</p>}
    </div>
  );
}
