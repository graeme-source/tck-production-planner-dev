import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
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

type Mode = "replace" | "append";

interface UseVoiceInputOptions {
  onTranscript: (text: string) => void;
  /** append merges new speech to existing text; replace swaps out current input. Default: append. */
  mode?: Mode;
  /** Value of the input when dictation starts (used for append mode). */
  getCurrentValue?: () => string;
}

export function useVoiceInput({ onTranscript, mode = "append", getCurrentValue }: UseVoiceInputOptions) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const supported = typeof window !== "undefined" && getSpeechRecognition() !== null;

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, []);

  const start = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) return;

    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }

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
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone permission denied. Enable it in browser settings.");
      } else if (event.error === "no-speech") {
        setError("Didn't hear anything. Tap the mic and try again.");
      } else {
        setError(`Voice input error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setError(null);
    setListening(true);

    try {
      recognition.start();
    } catch (err) {
      console.warn("[useVoiceInput] failed to start recognition:", err);
      setListening(false);
    }
  }, [getCurrentValue, mode, onTranscript]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  return { supported, listening, error, start, stop, toggle };
}
