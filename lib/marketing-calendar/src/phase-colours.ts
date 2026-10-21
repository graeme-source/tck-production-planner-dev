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
 * A phase with no colour (NULL) uses the calendar's default colour (a
 * setting, 2026-10-21 — any palette key or hex), and with that unset,
 * DEFAULT_PHASE_COLOUR, soft lavender.
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

// ── Any colour (Graeme, 2026-10-21): "I want to be able to change the
// DEFAULT colour of the phases, and I want to do it from a COLOUR PICKER
// rather than just a few options." ───────────────────────────────────────
//
// marketing_events.color (and the calendar's default-colour setting) holds
// EITHER one of the palette keys above — kept as quick picks, their
// hand-tuned tones unchanged — OR a hex colour "#2e86c1" from the picker.
// Tones for a hex are worked out here:
//
//   light mode  the bar / banner / chip is filled with the colour itself
//               (what you pick is what you see); border a little darker;
//               text a deep or pale tint, whichever reads better — always
//               4.5:1 or more.
//   dark mode   a muted version of the colour on the dark page, with
//               readable text the same way.

export const HEX_COLOUR_RE = /^#[0-9a-f]{6}$/i;

export function isHexColour(v: unknown): v is string {
  return typeof v === "string" && HEX_COLOUR_RE.test(v);
}

/** A value that can be stored as a phase colour: a palette key or "#rrggbb". */
export function isStoredPhaseColour(v: unknown): v is string {
  return isPhaseColour(v) || isHexColour(v);
}

/** Palette keys as they are; hex in lower case; anything else null. */
export function normalisePhaseColour(v: unknown): string | null {
  if (isPhaseColour(v)) return v;
  if (isHexColour(v)) return v.toLowerCase();
  return null;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex(c: [number, number, number]): string {
  return `#${c.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

/** `t` of the way from colour a to colour b (0 = a, 1 = b). */
export function mixHex(a: string, b: string, t: number): string {
  const x = rgb(a), y = rgb(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/** The lowest contrast allowed for words on a phase colour (WCAG AA). */
export const MIN_TEXT_CONTRAST = 4.5;

/**
 * Words on `bg`: a deep or pale tint of the same colour (nicer than plain
 * black/white), whichever reads better — and if even that is under 4.5:1,
 * plain black or white. One of black/white is at least 4.58:1 on ANY
 * colour, so the result always passes.
 */
export function readableTextOn(bg: string): string {
  const deep = mixHex(bg, "#000000", 0.82);
  const pale = mixHex(bg, "#ffffff", 0.9);
  const best = contrastRatio(deep, bg) >= contrastRatio(pale, bg) ? deep : pale;
  if (contrastRatio(best, bg) >= MIN_TEXT_CONTRAST) return best;
  return contrastRatio("#000000", bg) >= contrastRatio("#ffffff", bg) ? "#000000" : "#ffffff";
}

/** The dark-mode card the muted fill is mixed towards. */
const DARK_BASE = "#1b1e24";

/** Light- and dark-mode tones for any "#rrggbb". */
export function tonesFromHex(input: string): { light: PhaseTones; dark: PhaseTones } {
  const hex = input.toLowerCase();
  const lum = relativeLuminance(hex);
  // A near-white stripe would vanish on a white row, a near-black one on a dark row.
  const lightStripe = lum > 0.8 ? mixHex(hex, "#000000", 0.3) : hex;
  const darkStripe = lum < 0.04 ? mixHex(hex, "#ffffff", 0.4) : hex;
  const darkBg = mixHex(hex, DARK_BASE, 0.55);
  return {
    light: { bg: hex, border: mixHex(hex, "#000000", 0.2), text: readableTextOn(hex), stripe: lightStripe },
    dark: { bg: darkBg, border: mixHex(hex, DARK_BASE, 0.2), text: readableTextOn(darkBg), stripe: darkStripe },
  };
}

/** A phase colour ready to draw. */
export interface ResolvedPhaseColour {
  /** The stored value — a palette key or a lower-case hex. */
  key: string;
  label: string;
  /** For the colour picker / a swatch: the hex itself, or a palette colour's fill. */
  hex: string;
  light: PhaseTones;
  dark: PhaseTones;
}

function resolveOne(value: string): ResolvedPhaseColour {
  if (isPhaseColour(value)) {
    const c = PHASE_COLOURS[value];
    return { key: value, label: c.label, hex: c.light.bg, light: c.light, dark: c.dark };
  }
  const hex = value.toLowerCase();
  return { key: hex, label: hex.toUpperCase(), hex, ...tonesFromHex(hex) };
}

/**
 * The colour a phase is drawn in: its own; else the calendar's default
 * colour (the setting); else soft lavender. Unknown values are ignored.
 */
export function phaseColour(color: string | null | undefined, calendarDefault?: string | null): ResolvedPhaseColour {
  const own = normalisePhaseColour(color);
  if (own) return resolveOne(own);
  return resolveOne(normalisePhaseColour(calendarDefault) ?? DEFAULT_PHASE_COLOUR);
}

/** "Sky blue" / "#2E86C1" — for history lines; null = the calendar default. */
export function phaseColourLabel(color: string | null | undefined): string {
  const v = normalisePhaseColour(color);
  return v ? resolveOne(v).label : "the default colour";
}
