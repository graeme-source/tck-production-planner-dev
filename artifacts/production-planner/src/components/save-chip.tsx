/** The visible save state for an autosaving field (hooks/use-autosave.ts). */
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import type { AutosaveState } from "@/hooks/use-autosave";

export function SaveChip({ state, error, onRetry }: { state: AutosaveState; error?: string | null; onRetry?: () => void }) {
  return (
    <span className="text-sm font-semibold inline-flex items-center gap-1" aria-live="polite">
      {state === "saving" && <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Saving…</span>}
      {state === "dirty" && <span className="text-muted-foreground">Not saved yet…</span>}
      {state === "saved" && <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><Check className="w-4 h-4" /> Saved</span>}
      {state === "error" && (
        <button type="button" onClick={onRetry} className="flex items-center gap-1 text-destructive underline text-left">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error ?? "Couldn't save"} — retry
        </button>
      )}
    </span>
  );
}
