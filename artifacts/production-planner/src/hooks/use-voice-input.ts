import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  detectDictationPlatform,
  dictationCapability,
  micBlockedHelp,
  speechErrorMessage,
  type DictationCapability,
  type DictationPlatform,
  createDictationRegistry,
} from "@/lib/dictation-support";

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  /** Ends the session at once and frees the microphone. */
  abort?: () => void;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionResultEvent {
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: { transcript: string };
    };
  };
}

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Every recognition that's running, app-wide, so anything about to use the
// camera or microphone can free them first (Graeme, 2026-10-15: after
// dictating an improvement title, recording the before VIDEO failed with
// iOS's "you can't record video while on a call" — the dictation still held
// the audio session). stop() only asks the browser to finish; abort() ends it.
const registry = createDictationRegistry<SpeechRecognitionInstance>();
const active = registry.active;
const hardStop = registry.hardStop;

/** Free the microphone: end every running dictation now. Call it right
 *  before opening the camera or a video picker. */
export function releaseDictation(): void {
  registry.releaseAll();
}

type Mode = "replace" | "append";

interface UseVoiceInputOptions {
  onTranscript: (text: string) => void;
  /** Fired once when dictation stops, with the full dictated text. Lets a
   *  caller tidy the transcript automatically instead of making the user
   *  tap a second button — the whole point is that it's quick
   *  (Graeme, 2026-09-16). Not called when nothing was heard. */
  onFinished?: (text: string) => void;
  /** append merges new speech to existing text; replace swaps out current input. Default: append. */
  mode?: Mode;
  /** Value of the input when dictation starts (used for append mode). */
  getCurrentValue?: () => string;
}

export function useVoiceInput({ onTranscript, onFinished, mode = "append", getCurrentValue }: UseVoiceInputOptions) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const platform: DictationPlatform = useMemo(() => (
    typeof navigator === "undefined"
      ? { os: "other", browser: "other" }
      : detectDictationPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0)
  ), []);
  const capability: DictationCapability = useMemo(() => dictationCapability({
    hasSpeechApi: typeof window !== "undefined" && getSpeechRecognition() !== null,
    isSecureContext: typeof window === "undefined" ? true : window.isSecureContext !== false,
    platform,
  }), [platform]);
  const supported = capability.mode === "speech";

  // Know up front when the mic is blocked, so a tap explains how to allow it
  // instead of failing silently. Not every browser can answer (Firefox
  // throws) — then the recognition error tells us instead.
  const micDeniedRef = useRef(false);
  useEffect(() => {
    if (!supported || typeof navigator === "undefined" || !navigator.permissions?.query) return;
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const update = () => { micDeniedRef.current = status?.state === "denied"; };
    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then(s => {
        if (cancelled) return;
        status = s;
        update();
        s.addEventListener?.("change", update);
      })
      .catch(() => { /* this browser can't say — the recognition error will */ });
    return () => { cancelled = true; status?.removeEventListener?.("change", update); };
  }, [supported]);

  const stop = useCallback(() => {
    const r = recognitionRef.current;
    if (!r) return;
    // A graceful stop first, so the last words are kept…
    try { r.stop(); } catch { /* already ended */ }
    // …then make sure it really lets go of the microphone (iOS can hold the
    // audio session open after stop(), which blocks video recording).
    window.setTimeout(() => { if (active.has(r)) hardStop(r); }, 1200);
  }, []);

  const start = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) return;
    if (micDeniedRef.current) {
      setError(micBlockedHelp(platform));
      return;
    }

    if (recognitionRef.current) hardStop(recognitionRef.current);

    const recognition = new SR();
    recognition.lang = "en-GB";
    // Keep listening across pauses — staff may think mid-sentence while describing
    // an issue. Stops only when the user taps the mic again or closes the modal.
    recognition.continuous = true;
    recognition.interimResults = true;

    const startingText = mode === "append" ? (getCurrentValue?.() ?? "") : "";
    const needsSpace = startingText.length > 0 && !startingText.endsWith(" ");
    const prefix = startingText + (needsSpace ? " " : "");
    let finalText = "";

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      onTranscript((prefix + finalText + interim).trimStart());
    };

    recognition.onerror = (event) => {
      console.warn("[useVoiceInput] recognition error:", event.error);
      setListening(false);
      setError(speechErrorMessage(event.error, platform));
    };

    recognition.onend = () => {
      active.delete(recognition);
      setListening(false);
      recognitionRef.current = null;
      // Only when something was actually heard — onend also fires on abort
      // and on a permission refusal, and there's nothing to tidy then.
      const spoken = finalText.trim();
      if (spoken.length > 0) onFinishedRef.current?.((prefix + finalText).trimStart());
    };

    recognitionRef.current = recognition;
    active.add(recognition);
    setError(null);
    setListening(true);

    try {
      recognition.start();
    } catch (err) {
      console.warn("[useVoiceInput] failed to start recognition:", err);
      setListening(false);
      setError("Dictation couldn't start. Tap Dictate to try again.");
    }
  }, [getCurrentValue, mode, onTranscript, platform]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) hardStop(recognitionRef.current);
    };
  }, []);

  return { supported, capability, platform, listening, error, start, stop, toggle };
}
