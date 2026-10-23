/**
 * Live UPF / NOVA preview on the ingredient form (Graeme, 23 Oct 2026 —
 * objective G). As soon as the Label Declaration has text and the person
 * pauses, the declaration is classified (POST /api/upf/preview — stores
 * nothing) and the NOVA chips show the result. A chip the person taps is a
 * manual override and wins; saving still classifies server-side.
 * Pure helpers — the hook lives in the dialog.
 */

export const UPF_PREVIEW_DEBOUNCE_MS = 1500;

export interface UpfPreviewResult {
  novaClass: number | null;
  markers: string[];
  reasoning: string;
  confidence: string;
  method: "ai" | "markers";
}

/** The declaration text worth classifying, or null (blank / too short to mean anything). */
export function previewableDeclaration(text: string | null | undefined): string | null {
  const t = (text ?? "").trim().replace(/\s+/g, " ");
  return t.length >= 3 ? t : null;
}

/** "Auto: NOVA 4 — flavourings, emulsifier" / "Auto: NOVA 2 — no UPF markers". */
export function previewLabel(r: UpfPreviewResult | null | undefined): string {
  if (!r || r.novaClass == null) return "Auto: couldn't tell from the declaration — it will be tried again on save";
  if (r.novaClass === 4) {
    return `Auto: NOVA 4 — ${r.markers.length ? r.markers.join(", ") : "ultra-processed"}`;
  }
  return `Auto: NOVA ${r.novaClass} — no UPF markers`;
}

/** Which chip is lit. A chip the person tapped in this dialog wins; so does a
 *  class stored as a manual override (the automatic check never replaces it).
 *  Otherwise the live preview, then whatever is stored. */
export function displayedNovaClass(i: {
  touched: boolean;
  formValue: number | null;
  storedSource: string | null | undefined;
  preview: UpfPreviewResult | null | undefined;
}): { value: number | null; auto: boolean } {
  if (i.touched || i.storedSource === "manual") return { value: i.formValue, auto: false };
  if (i.preview && i.preview.novaClass != null) return { value: i.preview.novaClass, auto: true };
  return { value: i.formValue, auto: false };
}
