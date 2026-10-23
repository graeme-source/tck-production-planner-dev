import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

// "Anything to note?" on the break screen (Fix queue #61) — e.g. "called back
// for APC" when a lunch had to be interrupted. Optional; autosaves to the
// break a moment after typing stops (and straight away when the break is
// ended) with a visible save state. Shown in Analytics → Breaks & Lunches.

type SaveState = "idle" | "saving" | "saved" | "error";

const AUTOSAVE_MS = 800;

export function useBreakNoteAutosave(breakId: number | null) {
  const [note, setNoteState] = useState("");
  const [state, setState] = useState<SaveState>("idle");
  const lastSaved = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef("");

  // New break → fresh, empty note.
  useEffect(() => {
    setNoteState("");
    setState("idle");
    lastSaved.current = "";
    latest.current = "";
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, [breakId]);

  const mutation = useMutation({
    mutationFn: async (vars: { breakId: number; note: string }) => {
      const r = await fetch(`/api/station-breaks/${vars.breakId}/note`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: vars.note.trim() ? vars.note : null }),
      });
      if (!r.ok) throw new Error(`Note not saved (${r.status})`);
      return vars.note;
    },
    onMutate: () => setState("saving"),
    onSuccess: (saved) => {
      lastSaved.current = saved;
      setState(latest.current === saved ? "saved" : "saving");
    },
    onError: (err) => {
      console.warn("[BreakNote] save failed:", err);
      setState("error");
    },
  });
  const { mutate } = mutation;

  /** Save now if anything changed since the last save. */
  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (breakId == null) return;
    if (latest.current === lastSaved.current) return;
    mutate({ breakId, note: latest.current });
  }, [breakId, mutate]);

  const setNote = useCallback((v: string) => {
    setNoteState(v);
    latest.current = v;
    setState(v === lastSaved.current ? "saved" : "idle");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, AUTOSAVE_MS);
  }, [flush]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { note, setNote, state, flush };
}

export function BreakNoteField({ note, setNote, state, flush }: ReturnType<typeof useBreakNoteAutosave>) {
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <label htmlFor="break-note" className="text-gray-300 text-sm font-semibold">
          Anything to note? <span className="font-normal text-gray-500">(optional)</span>
        </label>
        <span
          className={cn(
            "text-xs font-medium inline-flex items-center gap-1",
            state === "error" ? "text-red-400" : state === "saved" ? "text-emerald-400" : "text-gray-400",
          )}
          aria-live="polite"
        >
          {state === "saving" && <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>}
          {state === "saved" && <><Check className="w-3 h-3" /> Saved</>}
          {state === "error" && (
            <button type="button" onClick={flush} className="inline-flex items-center gap-1 underline">
              <AlertTriangle className="w-3 h-3" /> Not saved — tap to retry
            </button>
          )}
        </span>
      </div>
      <textarea
        id="break-note"
        value={note}
        onChange={e => setNote(e.target.value)}
        onBlur={flush}
        rows={2}
        maxLength={500}
        placeholder="e.g. called back for APC"
        className="w-full rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-gray-500 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-white/40 resize-none"
      />
    </div>
  );
}
