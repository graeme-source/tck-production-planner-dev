/**
 * Phase colours (Graeme, 2026-10-21): "It's currently a very dark purple and
 * distracting. I want a lighter colour, and let me change it in the phase
 * editing section." Objective I.
 *
 * A small palette of LIGHT pastels, defined once here as data and used by
 * the server (validating marketing_events.color, migration 0209) and the
 * page (Month bars, List stripes / banners / chips, the colour swatches in
 * the phase modal). Every colour has dark, readable text on its pastel, and
 * a dark-mode version with light text on a muted tint — contrast is checked
 * in phase-colours.test.ts.
 *
 *   bg      the fill of a bar, banner or chip
 *   border  its outline
 *   text    words on the fill
 *   stripe  the thin List-view stripe and small swatches (a little stronger
 *           than bg so it shows on a white or dark row)
 *
 * A phase with no colour (NULL) uses DEFAULT_PHASE_COLOUR, soft lavender.
 */

export const PHASE_COLOUR_KEYS = ["lavender", "sky", "mint", "peach", "butter", "blush", "sage", "grey"] as const;
export type PhaseColourKey = (typeof PHASE_COLOUR_KEYS)[number];

export const DEFAULT_PHASE_COLOUR: PhaseColourKey = "lavender";

export interface PhaseTones { bg: string; border: string; text: string; stripe: string }
export interface PhaseColour { key: PhaseColourKey; label: string; light: PhaseTones; dark: PhaseTones }

export const PHASE_COLOURS: Record<PhaseColourKey, PhaseColour> = {
  lavender: {
    key: "lavender", label: "Soft lavender",
    light: { bg: "#ede9fe", border: "#c4b5fd", text: "#3b2470", stripe: "#a78bfa" },
    dark: { bg: "#2d2748", border: "#5b4f8f", text: "#e4ddff", stripe: "#a78bfa" },
  },
  sky: {
    key: "sky", label: "Sky blue",
    light: { bg: "#e0f2fe", border: "#93cfee", text: "#0c3d5c", stripe: "#38bdf8" },
    dark: { bg: "#1d3346", border: "#3f6f8f", text: "#d6efff", stripe: "#38bdf8" },
  },
  mint: {
    key: "mint", label: "Mint",
    light: { bg: "#d7f5e6", border: "#8fdcb6", text: "#0b4630", stripe: "#34d399" },
    dark: { bg: "#1b3a2e", border: "#3e7a5f", text: "#d2f7e5", stripe: "#34d399" },
  },
  peach: {
    key: "peach", label: "Peach",
    light: { bg: "#ffe8d6", border: "#f9bf94", text: "#6b2e0e", stripe: "#fb923c" },
    dark: { bg: "#42291b", border: "#8a5634", text: "#ffe3cf", stripe: "#fb923c" },
  },
  butter: {
    key: "butter", label: "Butter yellow",
    light: { bg: "#fdf6c3", border: "#ead77a", text: "#5a4505", stripe: "#eab308" },
    dark: { bg: "#3b351a", border: "#80712f", text: "#fbf1b8", stripe: "#eab308" },
  },
  blush: {
    key: "blush", label: "Blush pink",
    light: { bg: "#fde4ef", border: "#f3a9c9", text: "#6e1840", stripe: "#f472b6" },
    dark: { bg: "#42233a", border: "#8a4a72", text: "#ffdced", stripe: "#f472b6" },
  },
  sage: {
    key: "sage", label: "Sage",
    light: { bg: "#e4ecdf", border: "#b0c4a4", text: "#2c4224", stripe: "#8aa77c" },
    dark: { bg: "#2a3427", border: "#5c7353", text: "#e0ebd9", stripe: "#8aa77c" },
  },
  grey: {
    key: "grey", label: "Light grey",
    light: { bg: "#eef1f5", border: "#c5ccd6", text: "#1f2937", stripe: "#94a3b8" },
    dark: { bg: "#2a2f37", border: "#59616d", text: "#e5e9ef", stripe: "#94a3b8" },
  },
};

export function isPhaseColour(v: unknown): v is PhaseColourKey {
  return typeof v === "string" && (PHASE_COLOUR_KEYS as readonly string[]).includes(v);
}

/** The colour a phase is drawn in: its own, or soft lavender when it has none (or an unknown key). */
export function phaseColour(key: string | null | undefined): PhaseColour {
  return PHASE_COLOURS[isPhaseColour(key) ? key : DEFAULT_PHASE_COLOUR];
}

/** "Sky blue" — for history lines; null/unknown reads as the default. */
export function phaseColourLabel(key: string | null | undefined): string {
  return phaseColour(key).label;
}
