/**
 * Which pinned footer a review's editor shows (Graeme, 2026-10-13: "make
 * this save button always be at the bottom of this panel"). Objective H.
 *
 *   ai-paste  — "Add meeting notes (AI)" is open, nothing read yet:
 *               the footer is "Read the notes".
 *   ai-draft  — the AI's draft is open and NOT on the record: "Not saved
 *               yet" + Save to record (green), Read again, Discard.
 *   by-hand   — the feedback/objectives composer is open: its Save / Cancel.
 *   autosave  — otherwise every field saves itself: the combined save state
 *               ("All changes saved ✓" / "Saving…" / "Not saved — retry"),
 *               plus "Share with <first name>" when something of yours is
 *               still private.
 */
export type ReviewFooterMode = "ai-paste" | "ai-draft" | "by-hand" | "autosave";

export function reviewFooterMode(s: { aiOpen: boolean; hasDraft: boolean; byHand: boolean }): ReviewFooterMode {
  if (s.aiOpen) return s.hasDraft ? "ai-draft" : "ai-paste";
  if (s.byHand) return "by-hand";
  return "autosave";
}

/** "Share with <name>" belongs in the autosave footer only — never beside an
 *  unsaved draft or an open composer (save those first). */
export function showShareInFooter(mode: ReviewFooterMode, hasPrivateOfMine: boolean): boolean {
  return mode === "autosave" && hasPrivateOfMine;
}

/** One field's state, as hooks/use-autosave.ts reports it. */
export type FieldSaveState = "idle" | "dirty" | "saving" | "saved" | "error";
export type SaveSummary = "saved" | "pending" | "saving" | "error";

/** Every autosaving field in the modal, as one state: a failure wins (it
 *  needs a retry), then a save in flight, then typing not saved yet. Nothing
 *  touched counts as saved. */
export function summariseSaveStates(states: Iterable<FieldSaveState>): SaveSummary {
  let saving = false;
  let pending = false;
  for (const s of states) {
    if (s === "error") return "error";
    if (s === "saving") saving = true;
    else if (s === "dirty") pending = true;
  }
  if (saving) return "saving";
  if (pending) return "pending";
  return "saved";
}

export const SAVE_SUMMARY_LABEL: Record<SaveSummary, string> = {
  saved: "All changes saved ✓",
  pending: "Saving…",
  saving: "Saving…",
  error: "Not saved — retry",
};
