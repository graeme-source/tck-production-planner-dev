import { describe, it, expect } from "vitest";
import {
  shouldPromptShrinkWrap,
  printDialogLikelyShown,
  SHRINK_WRAP_REMAINING_THRESHOLD,
  PRINT_DIALOG_BLOCK_THRESHOLD_MS,
} from "./packing-alerts";

describe("shouldPromptShrinkWrap", () => {
  // remainingPackable is post-fridge-gate (Graeme, 2026-09-14): 120 orders
  // with only 105 coverable prompts once the PACKABLE remainder hits 15.
  const base = { remainingPackable: 15, view: "picking", acknowledged: false };

  it("fires at exactly 15 packable orders remaining", () => {
    expect(shouldPromptShrinkWrap(base)).toBe(true);
  });

  it("stays quiet at 16 packable remaining", () => {
    expect(shouldPromptShrinkWrap({ ...base, remainingPackable: 16 })).toBe(false);
  });

  it("fires all the way down to 1 remaining", () => {
    expect(shouldPromptShrinkWrap({ ...base, remainingPackable: 1 })).toBe(true);
  });

  it("stays quiet once the wave is done — nothing left to warm up for", () => {
    expect(shouldPromptShrinkWrap({ ...base, remainingPackable: 0 })).toBe(false);
  });

  it("never fires after acknowledgement", () => {
    expect(shouldPromptShrinkWrap({ ...base, acknowledged: true })).toBe(false);
  });

  it("fires on every packing-cycle view, not just picking", () => {
    for (const view of ["picking", "pre-confirm", "confirm"]) {
      expect(shouldPromptShrinkWrap({ ...base, view })).toBe(true);
    }
  });

  it("stays quiet on the list and dates views — the office reads those too", () => {
    for (const view of ["list", "dates"]) {
      expect(shouldPromptShrinkWrap({ ...base, view })).toBe(false);
    }
  });

  it("fires immediately for a wave that starts at or under the threshold", () => {
    expect(shouldPromptShrinkWrap({ ...base, remainingPackable: 12 })).toBe(true);
  });

  it("stays quiet while orders haven't loaded", () => {
    expect(shouldPromptShrinkWrap({ ...base, remainingPackable: null })).toBe(false);
    expect(shouldPromptShrinkWrap({ ...base, remainingPackable: undefined })).toBe(false);
  });

  it("threshold is 15 — the wrapper's measured warm-up in packing work", () => {
    expect(SHRINK_WRAP_REMAINING_THRESHOLD).toBe(15);
  });
});

describe("printDialogLikelyShown", () => {
  it("a kiosk-mode spool (milliseconds) is not a dialog", () => {
    expect(printDialogLikelyShown(15)).toBe(false);
    expect(printDialogLikelyShown(400)).toBe(false);
  });

  it("a call blocked past the threshold means a human clicked a dialog away", () => {
    expect(printDialogLikelyShown(PRINT_DIALOG_BLOCK_THRESHOLD_MS)).toBe(true);
    expect(printDialogLikelyShown(4200)).toBe(true);
  });
});
